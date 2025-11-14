const EventEmitter = require('events');
const { CONFIG } = require('../../config/config');
const { CandleRingBuffer } = require('../../repositories/candleRingBuffer');
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
	}

	async addData(timestamp, price, volume = 0) {
		const currentTime = new Date(timestamp);

		if (!this.candleStartTime) {
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

				await this.addToHistory(this.currentCandle);
				this.notifySubscribers(this.currentCandle);
			}

			this.startNewCandle(currentTime, price);
		} else {
			if (!this.currentCandle) {
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

		if (this.candleRepository) {
			try {
				await this.candleRepository.persistCandle(candle);
				this.emit('candleStored', candle);
			} catch (error) {
				logger.error('Error persisting candle to Aerospike:', error);
				this.emit('candleStoreError', error, candle);
			}
		} else {
			this.emit('candleStored', candle);
		}
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
			logger.info(`♻️  Restored ${recent.length} candles from Aerospike`);
		} catch (error) {
			logger.error('Error restoring candles from Aerospike:', error);
		}
	}

	async shutdown() {
		if (this.candleRepository) {
			await this.candleRepository.shutdown();
		}
	}
}

module.exports = { CandleService };

