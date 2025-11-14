const { TradingService } = require('./trading/tradingService');
const { SignalService } = require('./trading/signalService');
const { AnalyzerService } = require('./analysis/analyzerService');
const { CandleService } = require('./analysis/candleService');
const { SwingAnalyzer } = require('./analysis/swingAnalyzer');
const { MultiTimeframeAnalyzer } = require('./analysis/multiTimeframeAnalyzer');

module.exports = {
	TradingService,
	SignalService,
	AnalyzerService,
	CandleService,
	SwingAnalyzer,
	MultiTimeframeAnalyzer
};

