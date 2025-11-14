const { createClient } = require('redis');
const { CONFIG } = require('../../config/config');
const logger = require('../../utils/logger');

let clientPromise;

const buildRedisOptions = () => {
	const options = {};

	if (CONFIG.redis && CONFIG.redis.url) {
		options.url = CONFIG.redis.url;
	} else if (CONFIG.redis) {
		options.socket = {
			host: CONFIG.redis.host,
			port: CONFIG.redis.port,
			tls: CONFIG.redis.tls ? {} : undefined
		};
		if (CONFIG.redis.password) {
			options.password = CONFIG.redis.password;
		}
	}

	return options;
};

async function connectRedis() {
	if (!clientPromise) {
		clientPromise = (async () => {
			const options = buildRedisOptions();
			const client = createClient(options);

			client.on('error', (err) => {
				logger.error('Redis client error:', err);
			});

			await client.connect();
			return client;
		})();
	}

	return clientPromise;
}

async function disconnectRedis() {
	if (!clientPromise) return;
	try {
		const client = await clientPromise;
		await client.quit();
	} catch (error) {
		logger.error('Error disconnecting Redis client:', error);
	}
}

module.exports = {
	connectRedis,
	disconnectRedis
};

