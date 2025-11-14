const { BaseDataSource } = require('./data/BaseDataSource');
const { MqlDataSource } = require('./data/MqlDataSource');
const { BinanceDataSource } = require('./data/BinanceDataSource');
const { ManualDataSource } = require('./data/ManualDataSource');
const { connectAerospike, disconnectAerospike, getClient } = require('./storage/aerospikeClient');
const { connectRedis, disconnectRedis } = require('./storage/redisClient');

module.exports = {
	data: {
		BaseDataSource,
		MqlDataSource,
		BinanceDataSource,
		ManualDataSource
	},
	storage: {
		connectAerospike,
		disconnectAerospike,
		getAerospikeClient: getClient,
		connectRedis,
		disconnectRedis
	}
};

