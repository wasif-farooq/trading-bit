function getStatus(tradingService, analyzerService) {
	return async (req, res) => {
		res.json({
			symbol: tradingService.symbol,
			analyzer: analyzerService.getStatus(),
			openTrades: tradingService.getOpenTrades().length,
			tradeHistory: tradingService.getTradeHistory().length
		});
	};
}

module.exports = { getStatus };

