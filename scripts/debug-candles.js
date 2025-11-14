const fs = require('fs');
const csv = require('csv-parser');

function parseTimeframe(timeframe) {
	const timeframeMap = {
		'1s': 1000, '5s': 5000, '10s': 10000, '15s': 15000, '30s': 30000,
		'1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000,
		'1h': 3600000, '4h': 14400000, '1d': 86400000
	};
	return timeframeMap[timeframe.toLowerCase()];
}

function writeCandleDebug(candle, stream, priceType) {
	const startUTC = new Date(candle.startTime).toISOString();
	const endUTC = new Date(candle.endTime).toISOString();
	const firstTick = new Date(candle.firstTick).toISOString();
	const lastTick = new Date(candle.lastTick).toISOString();

	const line = `"${startUTC}","${endUTC}",${candle.open.toFixed(5)},${candle.high.toFixed(5)},${candle.low.toFixed(5)},${candle.close.toFixed(5)},${candle.tickCount},"${firstTick}","${lastTick}","${priceType}"\n`;
	stream.write(line);
}

function debugCandleCreation(inputPath, outputPath, timeframe = '1m', priceType = 'bid') {
	console.log('🔍 DEBUG MODE: Analyzing candle creation...');

	const timeframeMs = parseTimeframe(timeframe);
	if (!timeframeMs) {
		throw new Error(`Unsupported timeframe: ${timeframe}`);
	}

	const writeStream = fs.createWriteStream(outputPath);
	writeStream.write('candle_start_utc,candle_end_utc,open,high,low,close,ticks_count,first_tick_time,last_tick_time,price_type\n');
	let currentCandle = null;
	let candleCount = 0;
	let tickCount = 0;
	const recentTicks = [];

	fs.createReadStream(inputPath)
		.pipe(csv({
			mapHeaders: ({ header }) => header.trim().replace(/^"(.*)"$/, '$1'),
			mapValues: ({ value }) => value.trim().replace(/^"(.*)"$/, '$1')
		}))
		.on('data', (row) => {
			try {
				const timestampStr = row.Timestamp;
				const bid = parseFloat(row.Bid);
				const ask = parseFloat(row.Ask);

				if (!timestampStr || Number.isNaN(bid) || Number.isNaN(ask)) return;

				let timestamp;
				try {
					let dateStr = timestampStr;
					if (!dateStr.endsWith('Z') && !dateStr.includes('+')) {
						dateStr = dateStr.includes(' ') ? dateStr.replace(' ', 'T') + 'Z' : `${dateStr}Z`;
					} else if (dateStr.includes(' ')) {
						dateStr = dateStr.replace(' ', 'T');
					}
					timestamp = new Date(dateStr).getTime();
				} catch (error) {
					return;
				}

				if (Number.isNaN(timestamp)) return;

				const price = priceType === 'bid' ? bid : (priceType === 'ask' ? ask : (bid + ask) / 2);
				tickCount++;

				const candleStartTime = Math.floor(timestamp / timeframeMs) * timeframeMs;
				const candleEndTime = candleStartTime + timeframeMs - 1;

				if (!currentCandle || currentCandle.startTime !== candleStartTime) {
					if (currentCandle) {
						writeCandleDebug(currentCandle, writeStream, priceType);
						candleCount++;
					}

					currentCandle = {
						startTime: candleStartTime,
						endTime: candleEndTime,
						open: price,
						high: price,
						low: price,
						close: price,
						tickCount: 1,
						firstTick: timestamp,
						lastTick: timestamp,
						ticks: [price]
					};
				} else {
					currentCandle.high = Math.max(currentCandle.high, price);
					currentCandle.low = Math.min(currentCandle.low, price);
					currentCandle.close = price;
					currentCandle.tickCount++;
					currentCandle.lastTick = timestamp;
					currentCandle.ticks.push(price);
				}

				recentTicks.push({
					time: new Date(timestamp).toISOString(),
					bid,
					ask,
					price,
					candle: new Date(candleStartTime).toISOString()
				});
				if (recentTicks.length > 100) recentTicks.shift();
			} catch (error) {
				console.log('Error processing tick:', error);
			}
		})
		.on('end', () => {
			if (currentCandle) {
				writeCandleDebug(currentCandle, writeStream, priceType);
				candleCount++;
			}

			console.log('\n=== DEBUG ANALYSIS COMPLETE ===');
			console.log(`📊 Total ticks processed: ${tickCount}`);
			console.log(`🕯️ Total candles created: ${candleCount}`);
			console.log(`⏱️  Timeframe: ${timeframe}`);
			console.log(`💰 Price type: ${priceType}`);

			console.log('\n=== RECENT TICKS SAMPLE ===');
			recentTicks.slice(-5).forEach(tick => {
				console.log(`Time: ${tick.time}, Bid: ${tick.bid}, Ask: ${tick.ask}, Price: ${tick.price}, Candle: ${tick.candle}`);
			});

			writeStream.end();
		});
}

function testWithSampleData() {
	console.log('🧪 TESTING WITH SAMPLE DATA...\n');

	const sampleData = [
		{ Symbol: 'XAUUSD', Timestamp: '2025-11-02 23:01:30.015Z', Bid: 3990.743, Ask: 3990.855 },
		{ Symbol: 'XAUUSD', Timestamp: '2025-11-02 23:01:30.028Z', Bid: 3990.627, Ask: 3990.739 },
		{ Symbol: 'XAUUSD', Timestamp: '2025-11-02 23:01:30.132Z', Bid: 3990.594, Ask: 3990.706 },
		{ Symbol: 'XAUUSD', Timestamp: '2025-11-02 23:01:31.015Z', Bid: 3990.600, Ask: 3990.712 },
		{ Symbol: 'XAUUSD', Timestamp: '2025-11-02 23:01:31.128Z', Bid: 3990.720, Ask: 3990.832 },
		{ Symbol: 'XAUUSD', Timestamp: '2025-11-02 23:01:32.015Z', Bid: 3990.650, Ask: 3990.762 },
		{ Symbol: 'XAUUSD', Timestamp: '2025-11-02 23:02:00.015Z', Bid: 3991.000, Ask: 3991.112 },
		{ Symbol: 'XAUUSD', Timestamp: '2025-11-02 23:02:01.015Z', Bid: 3990.900, Ask: 3991.012 }
	];
	console.log('Sample data:');
	sampleData.forEach(row => {
		console.log(`Time: ${row.Timestamp}, Bid: ${row.Bid}, Ask: ${row.Ask}`);
	});
	console.log('\nExpected 1-minute candles:');
	console.log('Candle 1 (23:01:00 - 23:01:59):');
	console.log('  Open: 3990.743 (first bid at 23:01:30.015)');
	console.log('  High: 3990.720 (highest bid in minute)');
	console.log('  Low: 3990.594 (lowest bid in minute)');
	console.log('  Close: 3990.650 (last bid at 23:01:32.015)');

	console.log('\nCandle 2 (23:02:00 - 23:02:59):');
	console.log('  Open: 3991.000 (first bid at 23:02:00.015)');
	console.log('  High: 3991.000');
	console.log('  Low: 3990.900');
	console.log('  Close: 3990.900');
}

if (require.main === module) {
	if (process.argv[2]) {
		const inputFile = process.argv[2];
		const outputFile = process.argv[3] || './debug_candles.csv';
		const timeframe = process.argv[4] || '1m';
		const priceType = process.argv[5] || 'bid';

		if (fs.existsSync(inputFile)) {
			console.log(`\n🔍 Running debug analysis on: ${inputFile}`);
			debugCandleCreation(inputFile, outputFile, timeframe, priceType);
		} else {
			console.log('Usage: node scripts/debug-candles.js <input.csv> [output.csv] [timeframe] [priceType]');
			console.log('Example: node scripts/debug-candles.js ticks.csv debug.csv 1m bid');
		}
	} else {
		testWithSampleData();
	}
}

module.exports = {
	debugCandleCreation,
	parseTimeframe
};

