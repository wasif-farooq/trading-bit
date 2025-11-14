class Trade {
	constructor({
		ticket,
		symbol,
		type,
		volume,
		openPrice,
		currentPrice,
		profit,
		stopLoss,
		takeProfit,
		openTime,
		closeTime,
		status,
		comment
	}) {
		this.ticket = ticket;
		this.symbol = symbol;
		this.type = type;
		this.volume = volume;
		this.openPrice = openPrice;
		this.currentPrice = currentPrice;
		this.profit = profit;
		this.stopLoss = stopLoss;
		this.takeProfit = takeProfit;
		this.openTime = openTime;
		this.closeTime = closeTime;
		this.status = status;
		this.comment = comment;
	}

	toJSON() {
		return {
			ticket: this.ticket,
			symbol: this.symbol,
			type: this.type,
			volume: this.volume,
			openPrice: this.openPrice,
			currentPrice: this.currentPrice,
			profit: this.profit,
			stopLoss: this.stopLoss,
			takeProfit: this.takeProfit,
			openTime: this.openTime,
			closeTime: this.closeTime,
			status: this.status,
			comment: this.comment
		};
	}
}

module.exports = { Trade };

