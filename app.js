const COINS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
  { id: 'solana', symbol: 'SOL', name: 'Solana' }
];

const REFRESH_MS = 30000;
const AUTO_CYCLE_MS = 10000;

const elements = {
  coinGrid: document.getElementById('coinGrid'),
  lastUpdated: document.getElementById('lastUpdated'),
  refreshBtn: document.getElementById('refreshBtn'),
  selectedCoinTitle: document.getElementById('selectedCoinTitle'),
  selectedSignalPill: document.getElementById('selectedSignalPill'),
  selectedSummary: document.getElementById('selectedSummary'),
  scoreValue: document.getElementById('scoreValue'),
  buySellBias: document.getElementById('buySellBias'),
  buyAdvice: document.getElementById('buyAdvice'),
  sellAdvice: document.getElementById('sellAdvice'),
  chartKeyStats: document.getElementById('chartKeyStats'),
  subscores: document.getElementById('subscores'),
  metricsPanel: document.getElementById('metricsPanel'),
  autoCycleStatus: document.getElementById('autoCycleStatus')
};

let selectedCoin = COINS[0];
let selectedRange = 7;
let latestMarketData = [];
let latestSignalData = new Map();
let latestHistories = new Map();
let chartInstance = null;
let refreshTimer = null;
let cycleTimer = null;
let manualPauseUntil = 0;
let lastSuccessfulUpdate = null;

const clamp = (num, min, max) => Math.min(Math.max(num, min), max);
const average = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

function formatCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatPrice(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  if (value >= 1000) return `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (value >= 1) return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
}

function computeRSI(prices, period = 14) {
  if (!prices || prices.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function scoreCoin(marketCoin, rawPrices) {
  const prices = rawPrices.map(p => p[1]);
  const current = prices[prices.length - 1] ?? marketCoin.current_price;
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const ma7 = average(prices.slice(-7));
  const ma30 = average(prices.slice(-30));
  const rsi = computeRSI(prices);
  const rangePosition = high === low ? 0.5 : (current - low) / (high - low);
  const avgRecent = average(prices.slice(-7));
  const variance = average(prices.slice(-7).map(v => Math.pow(v - avgRecent, 2)));
  const volatilityPct = avgRecent ? (Math.sqrt(variance) / avgRecent) * 100 : 0;
  const change24 = marketCoin.price_change_percentage_24h || 0;
  const trendPct = ma30 ? ((current - ma30) / ma30) * 100 : 0;

  let trendScore = 50;
  if (current >= ma30) trendScore += 16;
  if (current >= ma7) trendScore += 10;
  if (trendPct > 5) trendScore += 8;
  if (trendPct < -5) trendScore -= 16;
  trendScore = clamp(Math.round(trendScore), 0, 100);

  let momentumScore = 50;
  if (change24 <= -7) momentumScore += 22;
  else if (change24 <= -3) momentumScore += 14;
  else if (change24 >= 8) momentumScore -= 20;
  else if (change24 >= 4) momentumScore -= 12;
  momentumScore = clamp(Math.round(momentumScore), 0, 100);

  let oversoldScore = 50;
  if (rsi !== null) {
    if (rsi < 30) oversoldScore += 32;
    else if (rsi < 40) oversoldScore += 16;
    else if (rsi > 72) oversoldScore -= 30;
    else if (rsi > 64) oversoldScore -= 16;
  }
  if (rangePosition < 0.22) oversoldScore += 14;
  if (rangePosition > 0.82) oversoldScore -= 14;
  oversoldScore = clamp(Math.round(oversoldScore), 0, 100);

  let riskScore = 55;
  if (volatilityPct < 2.5) riskScore += 20;
  else if (volatilityPct < 5) riskScore += 10;
  else if (volatilityPct > 9) riskScore -= 22;
  else if (volatilityPct > 7) riskScore -= 12;
  riskScore = clamp(Math.round(riskScore), 0, 100);

  const totalScore = Math.round(trendScore * 0.28 + momentumScore * 0.22 + oversoldScore * 0.30 + riskScore * 0.20);

  let signal = 'Hold / Watch';
  let signalClass = 'hold';
  let explanation = 'Mixed setup. Better to wait for a cleaner pullback or stronger confirmation before acting.';
  let bias = 'Neutral';

  if (totalScore >= 76) {
    signal = 'Strong Buy Zone';
    signalClass = 'strong-buy';
    bias = 'Buy Bias';
    explanation = 'Conditions look washed out but still structurally supportive. This is the strongest area for gradually buying.';
  } else if (totalScore >= 62) {
    signal = 'Buy Zone';
    signalClass = 'buy';
    bias = 'Buy Bias';
    explanation = 'Pullback conditions look favourable. This is a decent area to scale in rather than chase strength.';
  } else if (totalScore <= 32) {
    signal = 'Take Profit';
    signalClass = 'sell';
    bias = 'Sell Bias';
    explanation = 'Price looks extended or overheated. This is more attractive for trimming than adding.';
  } else if (totalScore <= 45) {
    signal = 'Reduce Risk';
    signalClass = 'sell';
    bias = 'Sell Bias';
    explanation = 'Fresh buying looks less attractive here. Risk/reward has worsened after the recent move.';
  }

  return {
    score: totalScore, signal, signalClass, explanation, bias, rsi, rangePosition, volatilityPct, trendPct, ma7, ma30,
    subscores: { Trend: trendScore, Momentum: momentumScore, Oversold: oversoldScore, Risk: riskScore }
  };
}

async function fetchMarketOverview() {
  const ids = COINS.map(c => c.id).join(',');
  const response = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=24h`);
  if (!response.ok) throw new Error('Failed to load market overview');
  return response.json();
}

async function fetchChartData(coinId, days) {
  const interval = days === 1 ? 'hourly' : 'daily';
  const response = await fetch(`https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=${interval}`);
  if (!response.ok) throw new Error('Failed to load chart data');
  return response.json();
}

async function buildSignals(marketData) {
  const histories = await Promise.all(marketData.map(async coin => [coin.id, await fetchChartData(coin.id, 30)]));
  latestHistories = new Map(histories);
  latestSignalData = new Map(marketData.map(coin => [coin.id, scoreCoin(coin, (latestHistories.get(coin.id)?.prices) || [])]));
}

function renderCards() {
  elements.coinGrid.innerHTML = '';
  latestMarketData.forEach(coin => {
    const signal = latestSignalData.get(coin.id);
    const change = coin.price_change_percentage_24h || 0;
    const changeClass = change > 0.35 ? 'positive' : change < -0.35 ? 'negative' : 'neutral';
    const card = document.createElement('div');
    card.className = `coin-card ${selectedCoin.id === coin.id ? 'active' : ''}`;
    card.innerHTML = `
      <div class="coin-top">
        <div class="coin-name">
          <div class="coin-logo">${coin.symbol.toUpperCase()}</div>
          <div>
            <div class="coin-symbol">${coin.symbol.toUpperCase()}</div>
            <div class="coin-fullname">${coin.name}</div>
          </div>
        </div>
        <span class="signal-pill ${signal.signalClass}">${signal.signal}</span>
      </div>
      <div class="price-row">
        <div class="price">${formatPrice(coin.current_price)}</div>
        <div class="change ${changeClass}">${change >= 0 ? '+' : ''}${change.toFixed(2)}%</div>
      </div>
      <div class="card-footer">
        <div class="score-chip"><span>Score</span><strong>${signal.score}/100</strong></div>
        <div class="small-muted">Rank #${coin.market_cap_rank}</div>
      </div>
      <div class="card-meta">
        <div class="meta-box"><div class="meta-label">Market cap</div><div class="meta-value">${formatCurrency(coin.market_cap)}</div></div>
        <div class="meta-box"><div class="meta-label">24h volume</div><div class="meta-value">${formatCurrency(coin.total_volume)}</div></div>
        <div class="meta-box"><div class="meta-label">RSI</div><div class="meta-value">${signal.rsi ? signal.rsi.toFixed(1) : '--'}</div></div>
        <div class="meta-box"><div class="meta-label">30D trend</div><div class="meta-value">${signal.trendPct >= 0 ? '+' : ''}${signal.trendPct.toFixed(1)}%</div></div>
      </div>`;
    card.addEventListener('click', () => selectCoinById(coin.id, true));
    elements.coinGrid.appendChild(card);
  });
}

function renderSelectedState() {
  const marketCoin = latestMarketData.find(c => c.id === selectedCoin.id);
  const signal = latestSignalData.get(selectedCoin.id);
  if (!marketCoin || !signal) return;
  elements.selectedCoinTitle.textContent = marketCoin.name;
  elements.selectedSignalPill.className = `signal-pill ${signal.signalClass}`;
  elements.selectedSignalPill.textContent = signal.signal;
  elements.selectedSummary.textContent = signal.explanation;
  elements.scoreValue.textContent = `${signal.score}/100`;
  elements.buySellBias.textContent = signal.bias;
  elements.buyAdvice.textContent = `Best when ${marketCoin.symbol.toUpperCase()} is pulling back, RSI is soft, price sits lower in its recent range, and the score climbs above 62.`;
  elements.sellAdvice.textContent = `Best when ${marketCoin.symbol.toUpperCase()} gets overheated, RSI rises sharply, price presses the upper end of its range, and the score drops below 45 after a run.`;
  elements.chartKeyStats.innerHTML = [
    ['Current price', formatPrice(marketCoin.current_price)],
    ['24h move', `${marketCoin.price_change_percentage_24h >= 0 ? '+' : ''}${marketCoin.price_change_percentage_24h.toFixed(2)}%`],
    ['RSI', signal.rsi ? signal.rsi.toFixed(1) : '--'],
    ['Volatility', `${signal.volatilityPct.toFixed(2)}%`]
  ].map(([label, value]) => `<div class="key-stat"><div class="meta-label">${label}</div><strong>${value}</strong></div>`).join('');
  elements.subscores.innerHTML = Object.entries(signal.subscores).map(([label, value]) => `<div class="subscore-box"><div class="subscore-label">${label}</div><strong>${value}/100</strong></div>`).join('');
  const metrics = [
    ['Current price', formatPrice(marketCoin.current_price)], ['Signal', signal.signal], ['Signal score', `${signal.score}/100`], ['Bias', signal.bias],
    ['24h change', `${marketCoin.price_change_percentage_24h >= 0 ? '+' : ''}${marketCoin.price_change_percentage_24h.toFixed(2)}%`], ['Market cap', formatCurrency(marketCoin.market_cap)],
    ['24h volume', formatCurrency(marketCoin.total_volume)], ['RSI', signal.rsi ? signal.rsi.toFixed(1) : '--'],
    ['Volatility', `${signal.volatilityPct.toFixed(2)}%`], ['7D average', formatPrice(signal.ma7)], ['30D average', formatPrice(signal.ma30)], ['30D trend', `${signal.trendPct >= 0 ? '+' : ''}${signal.trendPct.toFixed(2)}%`]
  ];
  elements.metricsPanel.innerHTML = metrics.map(([label, value]) => `<div class="metric-tile"><div class="metric-label">${label}</div><div class="metric-value">${value}</div></div>`).join('');
}

async function loadSelectedChart() {
  const history = await fetchChartData(selectedCoin.id, selectedRange);
  const prices = history.prices || [];
  const labels = prices.map(([ts]) => {
    const date = new Date(ts);
    return selectedRange === 1 ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString([], { day: 'numeric', month: 'short' });
  });
  const values = prices.map(([, price]) => price);
  const isUp = values[values.length - 1] >= values[0];
  const ctx = document.getElementById('priceChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();
  const gradient = ctx.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, isUp ? 'rgba(192, 38, 255, 0.32)' : 'rgba(255, 105, 136, 0.24)');
  gradient.addColorStop(1, 'rgba(192, 38, 255, 0.02)');
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ data: values, label: `${selectedCoin.symbol} price`, borderColor: isUp ? '#d06bff' : '#ff6988', backgroundColor: gradient, borderWidth: 3, pointRadius: 0, pointHoverRadius: 5, pointHitRadius: 18, tension: 0.34, fill: true }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(8, 8, 12, 0.96)', borderColor: 'rgba(192,38,255,0.35)', borderWidth: 1, titleColor: '#f4f3ff', bodyColor: '#efe6ff', displayColors: false,
          callbacks: { label: ctx => `${formatPrice(ctx.parsed.y)}` }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.035)', drawBorder: false }, ticks: { color: '#9e95be', maxTicksLimit: selectedRange === 1 ? 8 : 6 } },
        y: { grid: { color: 'rgba(255,255,255,0.045)', drawBorder: false }, ticks: { color: '#9e95be', callback: value => formatPrice(value) } }
      }
    }
  });
}

function setLastUpdatedText({ partial = false, failed = false } = {}) {
  if (lastSuccessfulUpdate) {
    const timeText = lastSuccessfulUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    elements.lastUpdated.textContent = partial ? `Last updated: ${timeText} • some data delayed` : `Last updated: ${timeText}`;
    return;
  }
  elements.lastUpdated.textContent = failed ? 'Last updated: waiting for first successful refresh' : 'Last updated: --';
}

function setAutoCycleText(active = true) {
  elements.autoCycleStatus.textContent = active ? 'Auto cycle: On' : 'Auto cycle: Paused after manual click';
}

async function selectCoinById(coinId, fromManualClick = false) {
  const next = COINS.find(c => c.id === coinId);
  if (!next) return;
  selectedCoin = next;
  if (fromManualClick) {
    manualPauseUntil = Date.now() + AUTO_CYCLE_MS;
    setAutoCycleText(false);
  }
  renderCards();
  renderSelectedState();
  await loadSelectedChart();
}

function cycleToNextCoin() {
  if (Date.now() < manualPauseUntil) return;
  setAutoCycleText(true);
  const currentIndex = COINS.findIndex(c => c.id === selectedCoin.id);
  const nextCoin = COINS[(currentIndex + 1) % COINS.length];
  selectCoinById(nextCoin.id, false);
}

function startTimers() {
  if (refreshTimer) clearInterval(refreshTimer);
  if (cycleTimer) clearInterval(cycleTimer);
  refreshTimer = setInterval(loadDashboard, REFRESH_MS);
  cycleTimer = setInterval(cycleToNextCoin, AUTO_CYCLE_MS);
}

async function loadDashboard() {
  elements.refreshBtn.disabled = true;
  let partialFailure = false;
  try {
    latestMarketData = await fetchMarketOverview();
  } catch (error) {
    console.error(error);
    setLastUpdatedText({ failed: true });
    elements.refreshBtn.disabled = false;
    return;
  }

  try {
    await buildSignals(latestMarketData);
  } catch (error) {
    console.error(error);
    partialFailure = true;
  }

  if (!latestSignalData.size) {
    latestSignalData = new Map(latestMarketData.map(coin => [coin.id, { score: 50, signal: 'Hold / Watch', signalClass: 'hold', explanation: 'Live market data loaded, but signal history is temporarily unavailable. Try refresh in a moment.', bias: 'Neutral', rsi: null, rangePosition: 0.5, volatilityPct: 0, trendPct: 0, ma7: coin.current_price, ma30: coin.current_price, subscores: { Trend: 50, Momentum: 50, Oversold: 50, Risk: 50 } }]));
  }

  renderCards();
  renderSelectedState();

  try {
    await loadSelectedChart();
  } catch (error) {
    console.error(error);
    partialFailure = true;
  }

  lastSuccessfulUpdate = new Date();
  setLastUpdatedText({ partial: partialFailure });
  elements.refreshBtn.disabled = false;
}

document.querySelectorAll('.range-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedRange = Number(btn.dataset.range);
    await loadSelectedChart();
  });
});

elements.refreshBtn.addEventListener('click', loadDashboard);

loadDashboard();
startTimers();
