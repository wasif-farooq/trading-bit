function createTradesController(tradingService) {
	return {
		getOpen: async (req, res, next) => {
			try {
				if (req.query.refresh === 'true') {
					await tradingService.refreshOpenTrades();
				}
				res.json({
					symbol: tradingService.symbol,
					trades: tradingService.getOpenTrades()
				});
			} catch (error) {
				next(error);
			}
		},

		getHistory: async (req, res, next) => {
			try {
				if (req.query.refresh === 'true') {
					await tradingService.refreshTradeHistory({
						from: req.query.from,
						to: req.query.to,
						symbol: req.query.symbol
					});
				}
				const history = tradingService.getTradeHistory();
				const limit = req.query.limit ? Number.parseInt(req.query.limit, 10) : history.length;
				res.json({
					symbol: tradingService.symbol,
					trades: history.slice(0, limit)
				});
			} catch (error) {
				next(error);
			}
		}
	};
}

module.exports = { createTradesController };

