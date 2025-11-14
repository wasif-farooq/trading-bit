const aerospike = require('aerospike');
const { CONFIG } = require('../../config/config');
const logger = require('../../utils/logger');

let clientInstance = null;
let clientPromise = null;

const buildAerospikeConfig = () => {
	const config = {
		hosts: [
			{
				addr: CONFIG.aerospike.host,
				port: CONFIG.aerospike.port
			}
		],
		log: {
			level: aerospike.log.INFO
		}
	};

	if (CONFIG.aerospike.user && CONFIG.aerospike.password) {
		config.user = CONFIG.aerospike.user;
		config.password = CONFIG.aerospike.password;
	}

	return config;
};

async function connectAerospike() {
	if (!clientPromise) {
		clientPromise = (async () => {
			try {
				const config = buildAerospikeConfig();
				const client = aerospike.client(config);

				await new Promise((resolve, reject) => {
					client.connect((error) => {
						if (error) {
							reject(error);
						} else {
							resolve();
						}
					});
				});

				clientInstance = client;
				logger.info('✅ Connected to Aerospike');
				return client;
			} catch (error) {
				logger.error('❌ Failed to connect to Aerospike:', error);
				clientPromise = null;
				throw error;
			}
		})();
	}

	return clientPromise;
}

async function disconnectAerospike() {
	if (!clientInstance) return;

	try {
		await new Promise((resolve, reject) => {
			clientInstance.close((error) => {
				if (error) {
					reject(error);
				} else {
					resolve();
				}
			});
		});
		clientInstance = null;
		clientPromise = null;
		logger.info('✅ Disconnected from Aerospike');
	} catch (error) {
		logger.error('❌ Error disconnecting from Aerospike:', error);
	}
}

function getClient() {
	if (!clientInstance) {
		throw new Error('Aerospike client not connected. Call connectAerospike() first.');
	}
	return clientInstance;
}

module.exports = {
	connectAerospike,
	disconnectAerospike,
	getClient
};

