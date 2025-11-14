const EventEmitter = require('events');
const { CONFIG } = require('../../config/config');
const { CandleRingBuffer } = require('../../repositories/candleRingBuffer');
const { MultiTimeframeCandleService } = require('./multiTimeframeCandleService');
const logger = require('../../utils/logger');

class CandleService extends EventEmitter {
	constructor(symbol = 'BTCUSDT', options = {}) {
		super();
		this.symbol = symbol;
		this.currentCandle = null;
		this.candleStartTime = null;
		this.isNewCandle = false;
		this.callbacks = [];
		this.ringBuffer = new CandleRingBuffer(CONFIG.live.maxHistoryBars);
		this.candleRepository = options.candleRepository || null;
		
		// Initialize multi-timeframe service if repositories are provided
		if (options.multiTimeframeRepositories) {
			this.multiTimeframeService = new MultiTimeframeCandleService(symbol, options.multiTimeframeRepositories);
			
			// Forward multi-timeframe candle events
			this.multiTimeframeService.on('candleStored', (candle, timeframe) => {
				this.emit('multiTimeframeCandleStored', candle, timeframe);
			});
			
			this.multiTimeframeService.on('candleStoreError', (error, candle, timeframe) => {
				this.emit('multiTimeframeCandleStoreError', error, candle, timeframe);
			});
		} else {
			this.multiTimeframeService = null;
		}
	}

	async addData(timestamp, price, volume = 0) {
		const currentTime = new Date(timestamp);

		if (!this.candleStartTime) {
			logger.debug(`🕯️ Starting first candle at ${currentTime.toISOString()}, price: ${price}`);
			this.startNewCandle(currentTime, price);
			return;
		}

		const timeDiff = currentTime - this.candleStartTime;

		if (timeDiff >= CONFIG.live.candleInterval) {
			if (this.currentCandle) {
				this.currentCandle.close = price;
				this.currentCandle.high = Math.max(this.currentCandle.high, price);
				this.currentCandle.low = Math.min(this.currentCandle.low, price);
				this.currentCandle.volume += volume;

				logger.info(`🕯️ Candle completed: ${this.currentCandle.timestamp}, O:${this.currentCandle.open.toFixed(2)} H:${this.currentCandle.high.toFixed(2)} L:${this.currentCandle.low.toFixed(2)} C:${this.currentCandle.close.toFixed(2)}`);
				await this.addToHistory(this.currentCandle);
				this.notifySubscribers(this.currentCandle);
			}

			this.startNewCandle(currentTime, price);
		} else {
			if (!this.currentCandle) {
				logger.debug(`🕯️ Starting new candle (no current candle) at ${currentTime.toISOString()}, price: ${price}`);
				this.startNewCandle(currentTime, price);
			} else {
				this.currentCandle.high = Math.max(this.currentCandle.high, price);
				this.currentCandle.low = Math.min(this.currentCandle.low, price);
				this.currentCandle.close = price;
				this.currentCandle.volume += volume;
			}
		}
	}

	startNewCandle(timestamp, price) {
		this.currentCandle = {
			timestamp: timestamp.toISOString(),
			open: price,
			high: price,
			low: price,
			close: price,
			volume: 0,
			originalTimestamp: timestamp.toISOString()
		};
		this.candleStartTime = timestamp;
		this.isNewCandle = true;
	}

	async addToHistory(candle) {
		this.ringBuffer.push({ ...candle });
		logger.info(`📦 Added candle to ring buffer. Total candles in buffer: ${this.ringBuffer.getAll().length}`);

		// Always emit candleStored event, regardless of persistence success
		// This ensures analysis runs even if Aerospike persistence fails
		if (this.candleRepository) {
			try {
				await this.candleRepository.persistCandle(candle);
				logger.debug(`✅ Candle persisted to Aerospike: ${candle.timestamp}`);
			} catch (error) {
				logger.error('Error persisting candle to Aerospike:', error);
				this.emit('candleStoreError', error, candle);
			}
		}
		
		// Forward to multi-timeframe service for aggregation
		if (this.multiTimeframeService) {
			try {
				await this.multiTimeframeService.processOneSecondCandle(candle);
			} catch (error) {
				logger.error('Error processing candle in multi-timeframe service:', error);
			}
		}
		
		// Emit candleStored event after adding to ring buffer (analysis doesn't depend on Aerospike)
		logger.info(`📢 Emitting 'candleStored' event for candle: ${candle.timestamp}`);
		this.emit('candleStored', candle);
		logger.info(`✅ 'candleStored' event emitted`);
	}

	subscribe(callback) {
		this.callbacks.push(callback);
	}

	notifySubscribers(candle) {
		this.callbacks.forEach(callback => {
			try {
				callback(candle);
			} catch (error) {
				logger.error('Error in candle callback:', error);
			}
		});
	}

	getCurrentCandle() {
		return this.currentCandle;
	}

	getCandleHistory(count = 1000) {
		return this.ringBuffer.getRecent(count);
	}

	getAllCandles() {
		return this.ringBuffer.getAll();
	}

	async restoreRecentCandles(count = 1000) {
		if (!this.candleRepository) return;

		try {
			const recent = await this.candleRepository.getRecentCandles(count);
			recent.forEach((candle) => {
				this.ringBuffer.push(candle);
			});
			logger.info(`♻️  Restored ${recent.length} 1s candles from Aerospike`);
		} catch (error) {
			logger.error('Error restoring candles from Aerospike:', error);
		}
		
		// Restore multi-timeframe candles
		if (this.multiTimeframeService) {
			await this.multiTimeframeService.restoreAllTimeframes(count);
		}
	}

	getMultiTimeframeService() {
		return this.multiTimeframeService;
	}

	async shutdown() {
		if (this.candleRepository) {
			await this.candleRepository.shutdown();
		}
		
		// Shutdown multi-timeframe repositories
		if (this.multiTimeframeService && this.multiTimeframeService.repositories) {
			for (const timeframe in this.multiTimeframeService.repositories) {
				const repo = this.multiTimeframeService.repositories[timeframe];
				if (repo && typeof repo.shutdown === 'function') {
					await repo.shutdown();
				}
			}
		}
	}
}

module.exports = { CandleService };

