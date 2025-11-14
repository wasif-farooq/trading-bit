const { getClient } = require('../infrastructure/storage/aerospikeClient');
const aerospike = require('aerospike');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class SwingLevelRepository {
	constructor({
		filePath = path.resolve(process.cwd(), 'data', 'swing-levels.json'),
		namespace = 'swing_levels',
		fallbackToFile = true
	} = {}) {
		this.filePath = filePath;
		this.namespace = namespace;
		this.fallbackToFile = fallbackToFile;
		this.cache = new Map();
		this.isLoaded = false;
	}

	async ensureLoaded() {
		if (this.isLoaded) return;

		try {
			const client = getClient();
			const set = 'levels';
			const results = [];

			const scan = client.scan(this.namespace, set);
			scan.nobins = false;

			await new Promise((resolve, reject) => {
				scan.foreach((error, record) => {
					if (error) {
						reject(error);
						return false;
					}

					if (!record || !record.bins) {
						return true;
					}

					const symbol = record.bins.symbol;
					const levelKey = record.bins.levelKey;
					const levelData = JSON.parse(record.bins.levelData);

					if (!this.cache.has(symbol)) {
						this.cache.set(symbol, new Map());
					}

					this.cache.get(symbol).set(levelKey, levelData);
					return true;
				}, (error) => {
					if (error) {
						reject(error);
					} else {
						resolve();
					}
				});
			});

			this.isLoaded = true;
		} catch (error) {
			logger.error('Error loading swing levels from Aerospike:', error);
			if (this.fallbackToFile) {
				await this.loadFromFile();
			} else {
				throw error;
			}
		}
	}

	async loadFromFile() {
		try {
			const raw = await fs.promises.readFile(this.filePath, 'utf8');
			const parsed = JSON.parse(raw);
			Object.entries(parsed).forEach(([symbol, levels]) => {
				const levelMap = new Map();
				levels.forEach((level) => {
					const key = this.levelKey(level);
					levelMap.set(key, level);
				});
				this.cache.set(symbol, levelMap);
			});
			this.isLoaded = true;
		} catch (error) {
			if (error.code === 'ENOENT') {
				await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
				await fs.promises.writeFile(this.filePath, JSON.stringify({}, null, 2), 'utf8');
				this.isLoaded = true;
			} else {
				throw error;
			}
		}
	}

	getLevels(symbol) {
		const levelMap = this.cache.get(symbol);
		if (!levelMap) return [];
		return Array.from(levelMap.values());
	}

	async setLevels(symbol, levels) {
		const levelMap = new Map();
		levels.forEach((level) => {
			const key = this.levelKey(level);
			levelMap.set(key, level);
		});
		this.cache.set(symbol, levelMap);

		try {
			await this.persistLevels(symbol, levels);
		} catch (error) {
			logger.error('Error persisting swing levels to Aerospike:', error);
			if (this.fallbackToFile) {
				await this.saveToFile();
			}
		}
	}

	async persistLevels(symbol, levels) {
		const client = getClient();
		const set = 'levels';

		const writePromises = levels.map((level) => {
			return new Promise((resolve, reject) => {
				const levelKey = this.levelKey(level);
				const price = level.commonPointPrice || level.price || 0;
				const key = aerospike.key(this.namespace, set, `${symbol}_${levelKey}`);
				const bins = {
					symbol: symbol,
					levelKey: levelKey,
					price: price,
					levelData: JSON.stringify(level)
				};

				const metadata = {
					ttl: 0
				};

				const policy = {
					exists: aerospike.policy.exists.REPLACE
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

		await Promise.all(writePromises);
	}

	async syncLevels(symbol, levels) {
		const existing = this.getLevels(symbol);
		const nextMap = new Map();

		levels.forEach((level) => {
			const key = this.levelKey(level);
			nextMap.set(key, level);
		});

		const toRemove = [];
		existing.forEach((level) => {
			const key = this.levelKey(level);
			if (!nextMap.has(key)) {
				toRemove.push(key);
			}
		});

		if (toRemove.length > 0) {
			await this.removeLevels(symbol, toRemove);
		}

		await this.setLevels(symbol, Array.from(nextMap.values()));
	}

	async removeLevels(symbol, levelKeys) {
		const client = getClient();
		const set = 'levels';

		const deletePromises = levelKeys.map((levelKey) => {
			return new Promise((resolve, reject) => {
				const key = aerospike.key(this.namespace, set, `${symbol}_${levelKey}`);
				client.remove(key, (error) => {
					if (error && error.code !== aerospike.status.AEROSPIKE_ERR_RECORD_NOT_FOUND) {
						reject(error);
					} else {
						resolve();
					}
				});
			});
		});

		await Promise.all(deletePromises);

		const levelMap = this.cache.get(symbol);
		if (levelMap) {
			levelKeys.forEach((key) => {
				levelMap.delete(key);
			});
		}
	}

	levelKey(level) {
		return `${level.commonPointType || level.type || 'UNKNOWN'}_${Math.round((level.commonPointPrice || level.price || 0) * 100000)}`;
	}

	async ensurePriceIndex() {
		const client = getClient();
		const indexName = 'price_idx';
		const set = 'levels';
		const bin = 'price';

		try {
			const task = client.indexCreate(
				this.namespace,
				set,
				indexName,
				bin,
				aerospike.indexType.NUMERIC,
				(error) => {
					if (error) {
						if (error.code === aerospike.status.AEROSPIKE_ERR_INDEX_ALREADY_EXISTS) {
							logger.info('✅ Price index already exists');
						} else {
							logger.error('Error creating price index:', error);
						}
					} else {
						logger.info('✅ Created price index for swing levels');
					}
				}
			);

			if (task) {
				await new Promise((resolve, reject) => {
					task.wait((error) => {
						if (error) {
							if (error.code === aerospike.status.AEROSPIKE_ERR_INDEX_ALREADY_EXISTS) {
								resolve();
							} else {
								reject(error);
							}
						} else {
							resolve();
						}
					});
				});
			}
		} catch (error) {
			if (error.code === aerospike.status.AEROSPIKE_ERR_INDEX_ALREADY_EXISTS) {
				logger.info('✅ Price index already exists');
			} else {
				logger.error('Error ensuring price index:', error);
				throw error;
			}
		}
	}

	async getLevelsInPriceRange(symbol, currentPrice, tolerance = 0.002) {
		const client = getClient();
		const set = 'levels';
		const minPrice = currentPrice * (1 - tolerance);
		const maxPrice = currentPrice * (1 + tolerance);

		const results = [];

		try {
			const query = client.query(this.namespace, set);
			const filter = aerospike.filter.range(
				'price',
				aerospike.indexType.NUMERIC,
				minPrice,
				maxPrice
			);
			query.where(filter);

			await new Promise((resolve, reject) => {
				const stream = query.foreach();
				
				stream.on('data', (record) => {
					if (!record || !record.bins) {
						return;
					}

					if (record.bins.symbol === symbol) {
						try {
							const level = JSON.parse(record.bins.levelData);
							results.push(level);
						} catch (error) {
							logger.warn('Error parsing level data:', error);
						}
					}
				});

				stream.on('end', () => {
					resolve();
				});

				stream.on('error', (error) => {
					reject(error);
				});
			});
		} catch (error) {
			logger.error('Error querying levels by price range:', error);
			throw error;
		}

		return results;
	}

	async saveToFile() {
		const payload = {};
		this.cache.forEach((levelMap, symbol) => {
			payload[symbol] = Array.from(levelMap.values());
		});
		await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
		await fs.promises.writeFile(this.filePath, JSON.stringify(payload, null, 2), 'utf8');
	}
}

module.exports = { SwingLevelRepository };

