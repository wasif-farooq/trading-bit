const EventEmitter = require('events');
const { CONFIG } = require('../../config/config');
const logger = require('../../utils/logger');

class TradingService extends EventEmitter {
	constructor({
		symbol,
		analyzer,
		dataSource,
		priceType = 'bid',
		defaultVolume = 0.1
	}) {
		super();

		if (!symbol) {
			throw new Error('TradingService requires a symbol');
		}

		if (!analyzer) {
			throw new Error('TradingService requires an AnalyzerService instance');
		}

		if (!dataSource) {
			throw new Error('TradingService requires a data source instance');
		}

		this.symbol = symbol;
		this.analyzer = analyzer;
		this.dataSource = dataSource;
		this.priceType = priceType;
		this.defaultVolume = defaultVolume;

		this.symbolSettings = new Map();
		this.openTrades = new Map();
		this.tradeHistory = [];
		this.maxHistory = 500;
		this.isStarted = false;

		this.attachAnalyzerListeners();
		this.attachDataSourceListeners();
	}

	attachAnalyzerListeners() {
		this.analyzer.on('signals', (signals, candle) => {
			signals.forEach(signal => {
				this.executeSignal(signal, candle).catch((error) => {
					this.emit('error', error);
				});
			});
		});
	}

	attachDataSourceListeners() {
		this.dataSource.on('connected', async () => {
			this.emit('data_source_connected');
			if (this.isMqlDataSource()) {
				try {
					await this.dataSource.subscribeTicks(this.symbol);
					await this.refreshOpenTrades();
				} catch (error) {
					this.emit('error', error);
				}
			}
		});

		this.dataSource.on('disconnected', () => {
			this.emit('data_source_disconnected');
		});

		this.dataSource.on('tick', (tick) => {
			this.handleTick(tick);
		});

		if (this.isMqlDataSource()) {
			this.dataSource.on('trade_update', (message) => {
				this.handleTradeUpdate(message);
			});

			this.dataSource.on('order_ack', (message) => {
				this.emit('order_ack', message);
			});
		}

		this.dataSource.on('error', (error) => {
			this.emit('error', error);
		});
	}

	isMqlDataSource() {
		return this.dataSource.constructor.name === 'MqlDataSource' || 
		       typeof this.dataSource.placeOrder === 'function';
	}

	start() {
		if (this.isStarted) return;
		this.isStarted = true;
		this.dataSource.start();
	}

	stop() {
		if (!this.isStarted) return;
		this.isStarted = false;
		this.dataSource.stop();
	}

	async handleTick(tick) {
		try {
			if (!tick || tick.symbol !== this.symbol) {
				return;
			}

			const timestamp = tick.timestamp ? new Date(tick.timestamp) : new Date();
			const bid = Number.parseFloat(tick.bid);
			const ask = Number.parseFloat(tick.ask);
			const volume = Number.parseFloat(tick.volume || 0);

			if (Number.isNaN(bid) || Number.isNaN(ask)) {
				return;
			}

			let price;
			switch (this.priceType) {
				case 'ask':
					price = ask;
					break;
				case 'mid':
				case 'midpoint':
					price = (bid + ask) / 2;
					break;
				case 'bid':
				default:
					price = bid;
					break;
			}

			await this.analyzer.addTradeData(timestamp, price, volume);
		} catch (error) {
			this.emit('error', error);
		}
	}

	async executeSignal(signal, candle) {
		const settings = this.getSymbolSettings(this.symbol);
		if (!settings || settings.autoTrade === false) {
			return;
		}

		if (!this.isMqlDataSource()) {
			logger.info('📊 Signal detected but auto-trading only supported with MQL data source');
			this.emit('signal_detected', { signal, candle });
			return;
		}

		const orderType = signal.buySignal ? 'buy' : (signal.sellSignal ? 'sell' : null);
		if (!orderType) {
			return;
		}

		const stopLoss = settings.stopLoss;
		const takeProfit = settings.takeProfit;
		const volume = settings.volume || this.defaultVolume;

		const orderPayload = {
			symbol: this.symbol,
			type: orderType,
			volume,
			price: candle.close,
			stopLoss,
			takeProfit,
			comment: `Signal:${signal.signalType}|${signal.commonPointType}|${signal.commonPointPrice.toFixed(4)}`
		};

		try {
			const response = await this.dataSource.placeOrder(orderPayload);
			this.emit('order_sent', { signal, response });
		} catch (error) {
			this.emit('error', error);
		}
	}

	handleTradeUpdate(message) {
		const trade = message.trade || message;
		if (!trade || !trade.ticket) {
			return;
		}

		if (trade.status === 'closed' || trade.isClosed) {
			this.openTrades.delete(trade.ticket);
			this.tradeHistory.unshift(trade);
			if (this.tradeHistory.length > this.maxHistory) {
				this.tradeHistory.length = this.maxHistory;
			}
		} else {
			this.openTrades.set(trade.ticket, trade);
		}

		this.emit('trade_update', trade);
	}

	async refreshOpenTrades() {
		if (!this.isMqlDataSource()) {
			return;
		}

		try {
			const response = await this.dataSource.requestOpenTrades();
			if (Array.isArray(response.trades)) {
				this.openTrades.clear();
				response.trades.forEach(trade => {
					if (trade && trade.ticket) {
						this.openTrades.set(trade.ticket, trade);
					}
				});
			}
		} catch (error) {
			this.emit('error', error);
		}
	}

	async refreshTradeHistory(params = {}) {
		if (!this.isMqlDataSource()) {
			return;
		}

		try {
			const response = await this.dataSource.requestTradeHistory(params);
			if (Array.isArray(response.trades)) {
				this.tradeHistory = response.trades.slice(0, this.maxHistory);
			}
		} catch (error) {
			this.emit('error', error);
		}
	}

	setSymbolSettings(symbol, settings) {
		const symbolKey = symbol.toUpperCase();
		this.symbolSettings.set(symbolKey, {
			autoTrade: true,
			volume: this.defaultVolume,
			stopLoss: settings.stopLoss ?? CONFIG.defaultStopLoss,
			takeProfit: settings.takeProfit ?? CONFIG.defaultTakeProfit,
			...settings
		});
	}

	getSymbolSettings(symbol) {
		const symbolKey = symbol.toUpperCase();
		if (!this.symbolSettings.has(symbolKey)) {
			this.setSymbolSettings(symbolKey, {
				stopLoss: 0,
				takeProfit: 0,
				volume: this.defaultVolume
			});
		}
		return this.symbolSettings.get(symbolKey);
	}

	removeSymbolSettings(symbol) {
		const symbolKey = symbol.toUpperCase();
		this.symbolSettings.delete(symbolKey);
	}

	getOpenTrades() {
		return Array.from(this.openTrades.values());
	}

	getTradeHistory() {
		return [...this.tradeHistory];
	}
}

module.exports = { TradingService };

