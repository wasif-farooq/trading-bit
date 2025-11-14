const EventEmitter = require('events');
const { CandleRingBuffer } = require('../../repositories/candleRingBuffer');
const logger = require('../../utils/logger');

class MultiTimeframeCandleService extends EventEmitter {
	constructor(symbol, repositories = {}) {
		super();
		this.symbol = symbol;
		this.repositories = repositories; // { '15s': repo, '1m': repo, '3m': repo, '5m': repo }
		
		// Track current candles for each timeframe
		this.currentCandles = {
			'15s': null,
			'1m': null,
			'3m': null,
			'5m': null
		};
		
		// Track start times for each timeframe
		this.candleStartTimes = {
			'15s': null,
			'1m': null,
			'3m': null,
			'5m': null
		};
		
		// In-memory ring buffers for each timeframe
		this.ringBuffers = {
			'15s': new CandleRingBuffer(10000),
			'1m': new CandleRingBuffer(10000),
			'3m': new CandleRingBuffer(10000),
			'5m': new CandleRingBuffer(10000)
		};
		
		// Timeframe intervals in milliseconds
		this.timeframeIntervals = {
			'15s': 15000,
			'1m': 60000,
			'3m': 180000,
			'5m': 300000
		};
	}

	/**
	 * Process a 1-second candle and aggregate into multi-timeframe candles
	 * @param {Object} oneSecondCandle - The completed 1-second candle
	 */
	async processOneSecondCandle(oneSecondCandle) {
		const candleTime = new Date(oneSecondCandle.timestamp);
		
		// Process each timeframe
		for (const timeframe of ['15s', '1m', '3m', '5m']) {
			await this.processTimeframe(timeframe, oneSecondCandle, candleTime);
		}
	}

	/**
	 * Process a candle for a specific timeframe
	 * @param {string} timeframe - The timeframe ('15s', '1m', '3m', '5m')
	 * @param {Object} oneSecondCandle - The 1-second candle to aggregate
	 * @param {Date} candleTime - The timestamp of the 1-second candle
	 */
	async processTimeframe(timeframe, oneSecondCandle, candleTime) {
		const interval = this.timeframeIntervals[timeframe];
		
		if (!this.candleStartTimes[timeframe]) {
			// Start new candle for this timeframe
			this.startNewCandle(timeframe, candleTime, oneSecondCandle);
			return;
		}

		const timeDiff = candleTime.getTime() - this.candleStartTimes[timeframe].getTime();

		if (timeDiff >= interval) {
			// Complete current candle if it exists
			if (this.currentCandles[timeframe]) {
				// Finalize current candle with the last known values
				// Note: We use the incoming candle's values as the final values
				this.currentCandles[timeframe].close = oneSecondCandle.close;
				this.currentCandles[timeframe].high = Math.max(this.currentCandles[timeframe].high, oneSecondCandle.high);
				this.currentCandles[timeframe].low = Math.min(this.currentCandles[timeframe].low, oneSecondCandle.low);
				this.currentCandles[timeframe].volume += oneSecondCandle.volume;

				// Store completed candle
				await this.storeCompletedCandle(timeframe, this.currentCandles[timeframe]);
			}

			// Handle multiple intervals - if we skipped more than one interval, we need to create empty candles for the gaps
			// Calculate how many intervals we've skipped
			const intervalsSkipped = Math.floor(timeDiff / interval);
			
			if (intervalsSkipped > 1) {
				// Create empty candles for skipped intervals
				for (let i = 1; i < intervalsSkipped; i++) {
					const skippedIntervalStart = new Date(this.candleStartTimes[timeframe].getTime() + (i * interval));
					const emptyCandle = {
						timestamp: skippedIntervalStart.toISOString(),
						timeframe: timeframe,
						open: oneSecondCandle.close, // Use last known price
						high: oneSecondCandle.close,
						low: oneSecondCandle.close,
						close: oneSecondCandle.close,
						volume: 0,
						originalTimestamp: skippedIntervalStart.toISOString()
					};
					await this.storeCompletedCandle(timeframe, emptyCandle);
					logger.debug(`[${timeframe}] Created empty candle for skipped interval: ${emptyCandle.timestamp}`);
				}
			}

			// Start new candle (handles gaps by starting fresh)
			this.startNewCandle(timeframe, candleTime, oneSecondCandle);
		} else {
			// Update current candle
			if (!this.currentCandles[timeframe]) {
				this.startNewCandle(timeframe, candleTime, oneSecondCandle);
			} else {
				this.currentCandles[timeframe].high = Math.max(this.currentCandles[timeframe].high, oneSecondCandle.high);
				this.currentCandles[timeframe].low = Math.min(this.currentCandles[timeframe].low, oneSecondCandle.low);
				this.currentCandles[timeframe].close = oneSecondCandle.close;
				this.currentCandles[timeframe].volume += oneSecondCandle.volume;
			}
		}
	}

	/**
	 * Start a new candle for a timeframe
	 * @param {string} timeframe - The timeframe
	 * @param {Date} timestamp - The timestamp
	 * @param {Object} oneSecondCandle - The first 1-second candle in this timeframe
	 */
	startNewCandle(timeframe, timestamp, oneSecondCandle) {
		// Round down to the start of the timeframe period
		const interval = this.timeframeIntervals[timeframe];
		const startTime = new Date(Math.floor(timestamp.getTime() / interval) * interval);
		
		this.currentCandles[timeframe] = {
			timestamp: startTime.toISOString(),
			timeframe: timeframe,
			open: oneSecondCandle.open,
			high: oneSecondCandle.high,
			low: oneSecondCandle.low,
			close: oneSecondCandle.close,
			volume: oneSecondCandle.volume,
			originalTimestamp: oneSecondCandle.originalTimestamp || oneSecondCandle.timestamp
		};
		this.candleStartTimes[timeframe] = startTime;
	}

	/**
	 * Store a completed candle to both memory and Aerospike
	 * @param {string} timeframe - The timeframe
	 * @param {Object} candle - The completed candle
	 */
	async storeCompletedCandle(timeframe, candle) {
		// Add to in-memory ring buffer
		if (!this.ringBuffers[timeframe]) {
			logger.error(`[${timeframe}] Ring buffer not initialized!`);
			return;
		}
		
		this.ringBuffers[timeframe].push({ ...candle });
		const bufferSize = this.ringBuffers[timeframe].getSize();
		logger.info(`[${timeframe}] Completed candle: ${candle.timestamp}, O:${candle.open.toFixed(2)} H:${candle.high.toFixed(2)} L:${candle.low.toFixed(2)} C:${candle.close.toFixed(2)} (buffer size: ${bufferSize})`);

		// Persist to Aerospike
		const repository = this.repositories[timeframe];
		if (repository) {
			try {
				await repository.persistCandle(candle);
				logger.info(`[${timeframe}] ✅ Candle persisted to Aerospike: ${candle.timestamp}`);
			} catch (error) {
				logger.error(`[${timeframe}] ❌ Error persisting candle to Aerospike:`, error);
				this.emit('candleStoreError', error, candle, timeframe);
			}
		} else {
			logger.warn(`[${timeframe}] ⚠️  No repository available for persistence`);
		}

		// Emit event for this timeframe candle
		this.emit('candleStored', candle, timeframe);
	}

	/**
	 * Get candles for a specific timeframe
	 * @param {string} timeframe - The timeframe
	 * @param {number} count - Number of candles to retrieve (optional)
	 * @returns {Array} Array of candles
	 */
	getCandles(timeframe, count = null) {
		if (!this.ringBuffers[timeframe]) {
			logger.warn(`[${timeframe}] Ring buffer not initialized`);
			return [];
		}
		
		const bufferSize = this.ringBuffers[timeframe].getSize();
		logger.debug(`[${timeframe}] Ring buffer size: ${bufferSize}`);
		
		if (count !== null) {
			const candles = this.ringBuffers[timeframe].getRecent(count);
			logger.debug(`[${timeframe}] Retrieved ${candles.length} candles from ring buffer (requested: ${count})`);
			return candles;
		}
		
		const allCandles = this.ringBuffers[timeframe].getAll();
		logger.debug(`[${timeframe}] Retrieved ${allCandles.length} candles from ring buffer (all)`);
		return allCandles;
	}

	/**
	 * Get all candles for a timeframe
	 * @param {string} timeframe - The timeframe
	 * @returns {Array} Array of all candles
	 */
	getAllCandles(timeframe) {
		return this.getCandles(timeframe);
	}

	/**
	 * Restore recent candles from Aerospike for a specific timeframe
	 * @param {string} timeframe - The timeframe
	 * @param {number} count - Number of candles to restore
	 */
	async restoreRecentCandles(timeframe, count = 1000) {
		const repository = this.repositories[timeframe];
		if (!repository) {
			logger.warn(`[${timeframe}] No repository available for restore`);
			return;
		}

		try {
			const recentCandles = await repository.getRecentCandles(count);
			recentCandles.forEach((candle) => {
				this.ringBuffers[timeframe].push(candle);
			});
			logger.info(`[${timeframe}] Restored ${recentCandles.length} candles from Aerospike`);
		} catch (error) {
			logger.error(`[${timeframe}] Error restoring candles from Aerospike:`, error);
		}
	}

	/**
	 * Restore recent candles for all timeframes
	 * @param {number} count - Number of candles to restore per timeframe
	 */
	async restoreAllTimeframes(count = 1000) {
		const timeframes = ['15s', '1m', '3m', '5m'];
		for (const timeframe of timeframes) {
			await this.restoreRecentCandles(timeframe, count);
		}
	}
}

module.exports = { MultiTimeframeCandleService };

