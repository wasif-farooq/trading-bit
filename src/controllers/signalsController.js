function createSignalsController(analyzerService) {
	return {
		getSummary: async (req, res, next) => {
			try {
				const summary = analyzerService.getSignalService().getSignalsSummary();
				res.json(summary);
			} catch (error) {
				next(error);
			}
		}
	};
}

module.exports = { createSignalsController };

