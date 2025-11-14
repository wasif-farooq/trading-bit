const { getClient } = require('../infrastructure/storage/aerospikeClient');
const aerospike = require('aerospike');
const logger = require('../utils/logger');

class CandleRepository {
	constructor(symbol, namespace = 'candles', timeframe = '1s') {
		this.symbol = symbol;
		this.namespace = namespace;
		this.timeframe = timeframe;
		// For 1s candles: XAUUSD_candles, for multi-timeframe: XAUUSD_15s, XAUUSD_1m, etc.
		this.set = timeframe === '1s' ? `${symbol}_candles` : `${symbol}_${timeframe}`;
		this.batchSize = 100;
		this.pendingWrites = [];
		this.flushInterval = 5000;
		this.flushTimer = null;
		this.startFlushTimer();
	}

	startFlushTimer() {
		if (this.flushTimer) {
			clearInterval(this.flushTimer);
		}

		this.flushTimer = setInterval(() => {
			this.flush().catch((error) => {
				logger.error('Error flushing candles to Aerospike:', error);
			});
		}, this.flushInterval);
	}

	stopFlushTimer() {
		if (this.flushTimer) {
			clearInterval(this.flushTimer);
			this.flushTimer = null;
		}
	}

	async persistCandle(candle) {
		const client = getClient();

		return new Promise((resolve, reject) => {
			// Validate candle data
			if (!candle || !candle.timestamp) {
				reject(new Error('Invalid candle: missing timestamp'));
				return;
			}

			// Ensure all numeric values are valid
			const open = Number(candle.open);
			const high = Number(candle.high);
			const low = Number(candle.low);
			const close = Number(candle.close);
			const volume = Number(candle.volume || 0);

			if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close) || isNaN(volume)) {
				reject(new Error(`Invalid candle: NaN values - open=${open}, high=${high}, low=${low}, close=${close}, volume=${volume}`));
				return;
			}

			// Use numeric timestamp as key (milliseconds since epoch)
			// This avoids potential issues with string keys containing special characters
			const timestampMs = new Date(candle.timestamp).getTime();
			const key = new aerospike.Key(this.namespace, this.set, timestampMs);
			const bins = {
				symbol: String(this.symbol),
				timestamp: String(candle.timestamp),
				timeframe: String(this.timeframe), // Add timeframe for identification
				open: open,
				high: high,
				low: low,
				close: close,
				volume: volume,
				origTs: String(candle.originalTimestamp || candle.timestamp) // Shortened to fit 16 char limit
			};

			// Use metadata with TTL, no custom policy (use defaults)
			const metadata = {
				ttl: 7 * 24 * 60 * 60 // 7 days in seconds
			};

			// Try without policy parameter - use default policy
			client.put(key, bins, metadata, (error) => {
				if (error) {
					logger.error(`Aerospike put error: ${error.message}`, { 
						namespace: this.namespace, 
						set: this.set, 
						key: candle.timestamp,
						errorCode: error.code 
					});
					reject(error);
				} else {
					logger.debug(`✅ Successfully stored candle: ${candle.timestamp}`);
					resolve();
				}
			});
		});
	}

	async flush() {
		if (this.pendingWrites.length === 0) return;

		const batch = this.pendingWrites.splice(0, this.batchSize);
		const client = getClient();

		const writePromises = batch.map((candle) => {
			return new Promise((resolve, reject) => {
				// Use numeric timestamp as key (milliseconds since epoch)
				const timestampMs = new Date(candle.timestamp).getTime();
				const key = new aerospike.Key(this.namespace, this.set, timestampMs);
				const bins = {
					symbol: String(this.symbol),
					timestamp: String(candle.timestamp),
					timeframe: String(this.timeframe), // Add timeframe for identification
					open: Number(candle.open),
					high: Number(candle.high),
					low: Number(candle.low),
					close: Number(candle.close),
					volume: Number(candle.volume || 0),
					origTs: String(candle.originalTimestamp || candle.timestamp) // Shortened to fit 16 char limit
				};

				const metadata = {
					ttl: 7 * 24 * 60 * 60 // 7 days in seconds
				};

				const writePolicy = {
					exists: aerospike.policy.exists.IGNORE
				};

				client.put(key, bins, metadata, writePolicy, (error) => {
					if (error) {
						reject(error);
					} else {
						resolve();
					}
				});
			});
		});

		try {
			await Promise.all(writePromises);
		} catch (error) {
			logger.error('Error writing candles batch to Aerospike:', error);
			throw error;
		}
	}

	async getCandles(fromTimestamp, toTimestamp, limit = 1000) {
		const client = getClient();
		const results = [];

		try {
			const scan = client.scan(this.namespace, this.set);
			scan.nobins = false;

			scan.foreach((error, record) => {
				if (error) {
					logger.error('Scan error:', error);
					return false;
				}

				if (!record || !record.bins) {
					return true;
				}

				const timestamp = record.bins.timestamp;
				if (timestamp >= fromTimestamp && timestamp <= toTimestamp) {
					results.push({
						timestamp: record.bins.timestamp,
						timeframe: record.bins.timeframe || this.timeframe, // Include timeframe
						open: record.bins.open,
						high: record.bins.high,
						low: record.bins.low,
						close: record.bins.close,
						volume: record.bins.volume,
						originalTimestamp: record.bins.origTs || record.bins.timestamp // Map back from shortened name
					});

					if (results.length >= limit) {
						return false;
					}
				}

				return true;
			}, (error) => {
				if (error) {
					logger.error('Scan completion error:', error);
				}
			});
		} catch (error) {
			logger.error('Error scanning candles from Aerospike:', error);
			throw error;
		}

		return results.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
	}

	async getRecentCandles(count = 1000) {
		const now = new Date().toISOString();
		const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
		return this.getCandles(from, now, count);
	}

	async shutdown() {
		this.stopFlushTimer();
		await this.flush();
	}
}

module.exports = { CandleRepository };

