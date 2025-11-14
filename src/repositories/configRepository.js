const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class ConfigRepository {
	constructor({
		filePath = path.resolve(process.cwd(), 'data', 'symbol-settings.json'),
		redisClient = null,
		redisNamespace = 'symbol_settings'
	} = {}) {
		this.filePath = filePath;
		this.redisClient = redisClient;
		this.redisNamespace = redisNamespace;
		this.cache = new Map();
		this.isLoaded = false;
	}

	async load() {
		if (this.isLoaded) {
			return;
		}

		let loadedFromRedis = false;

		if (this.redisClient) {
			try {
				const entries = await this.redisClient.hGetAll(this.redisNamespace);
				Object.entries(entries).forEach(([symbol, json]) => {
					try {
						const settings = JSON.parse(json);
						this.cache.set(symbol, settings);
					} catch (error) {
						logger.warn(`Failed to parse redis settings for ${symbol}:`, error);
					}
				});
				this.isLoaded = true;
				loadedFromRedis = true;
			} catch (error) {
				logger.error('Error loading symbol settings from Redis, falling back to file storage:', error);
			}
		}

		if (!loadedFromRedis) {
			try {
				const data = await fs.promises.readFile(this.filePath, 'utf8');
				const parsed = JSON.parse(data);
				Object.entries(parsed).forEach(([symbol, settings]) => {
					this.cache.set(symbol, settings);
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
	}

	async persist(symbol, settings) {
		if (this.redisClient) {
			try {
				await this.redisClient.hSet(this.redisNamespace, symbol, JSON.stringify(settings));
				return;
			} catch (error) {
				logger.error('Error persisting symbol settings to Redis:', error);
			}
		}

		await this.saveToFile();
	}

	async remove(symbol) {
		if (this.redisClient) {
			try {
				await this.redisClient.hDel(this.redisNamespace, symbol);
				return;
			} catch (error) {
				logger.error('Error removing symbol settings from Redis:', error);
			}
		}

		await this.saveToFile();
	}

	async saveToFile() {
		const data = {};
		this.cache.forEach((value, key) => {
			data[key] = value;
		});
		await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
		await fs.promises.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8');
	}

	getAll() {
		return Array.from(this.cache.entries()).map(([symbol, settings]) => ({
			symbol,
			settings
		}));
	}

	get(symbol) {
		return this.cache.get(symbol);
	}

	set(symbol, settings) {
		this.cache.set(symbol, settings);
		return settings;
	}

	delete(symbol) {
		this.cache.delete(symbol);
	}
}

module.exports = { ConfigRepository };

