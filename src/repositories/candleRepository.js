const { getClient } = require('../infrastructure/storage/aerospikeClient');
const aerospike = require('aerospike');
const logger = require('../utils/logger');

class CandleRepository {
	constructor(symbol, namespace = 'candles') {
		this.symbol = symbol;
		this.namespace = namespace;
		this.set = `${symbol}_candles`;
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
			const key = aerospike.key(this.namespace, this.set, candle.timestamp);
			const bins = {
				symbol: this.symbol,
				timestamp: candle.timestamp,
				open: candle.open,
				high: candle.high,
				low: candle.low,
				close: candle.close,
				volume: candle.volume,
				originalTimestamp: candle.originalTimestamp
			};

			const metadata = {
				ttl: 7 * 24 * 60 * 60
			};

			const policy = {
				exists: aerospike.policy.exists.IGNORE
			};

			client.put(key, bins, metadata, policy, (error) => {
				if (error) {
					reject(error);
				} else {
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
				const key = aerospike.key(this.namespace, this.set, candle.timestamp);
				const bins = {
					symbol: this.symbol,
					timestamp: candle.timestamp,
					open: candle.open,
					high: candle.high,
					low: candle.low,
					close: candle.close,
					volume: candle.volume,
					originalTimestamp: candle.originalTimestamp
				};

				const metadata = {
					ttl: 7 * 24 * 60 * 60
				};

				const policy = {
					exists: aerospike.policy.exists.IGNORE
				};

				client.put(key, bins, metadata, policy, (error) => {
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
						open: record.bins.open,
						high: record.bins.high,
						low: record.bins.low,
						close: record.bins.close,
						volume: record.bins.volume,
						originalTimestamp: record.bins.originalTimestamp
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

