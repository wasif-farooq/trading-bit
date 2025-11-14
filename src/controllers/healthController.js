const { getClient } = require('../infrastructure/storage/aerospikeClient');

function getHealth(tradingService, analyzerService) {
	return async (req, res) => {
		res.json({
			status: 'ok',
			dataSourceConnected: tradingService.dataSource.isConnected,
			analyzer: analyzerService.getStatus(),
			aerospikeConnected: (() => {
				try {
					return Boolean(getClient());
				} catch {
					return false;
				}
			})()
		});
	};
}

module.exports = { getHealth };

