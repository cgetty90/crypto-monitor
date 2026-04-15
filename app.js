const COINS = [
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum" },
  { id: "solana", symbol: "SOL", name: "Solana" }
];

const state = {
  selectedCoin: "bitcoin",
  selectedDays: 30,
  chart: null,
  marketData: [],
  chartCache: {},
  chartRequestToken: 0
};

const els = {
  coinGrid: document.getElementById("coinGrid"),
  chartTitle: document.getElementById("chartTitle"),
  refreshBtn: document.getElementById("refreshBtn"),
  lastUpdated: document.getElementById("lastUpdated"),
  selectedAssetName: document.getElementById("selectedAssetName"),
  signalPill: document.getElementById("signalPill"),
  actionBias: document.getElementById("actionBias"),
  buyScore: document.getElementById("buyScore"),
  sellScore: document.getElementById("sellScore"),
  change24h: document.getElementById("change24h"),
  guidanceText: document.getElementById("guidanceText"),
  metricPrice: document.getElementById("metricPrice"),
  metricMarketCap: document.getElementById("metricMarketCap"),
  metricVolume: document.getElementById("metricVolume"),
  metricRank: document.getElementById("metricRank"),
  timeframeButtons: Array.from(document.querySelectorAll(".time-buttons button")),
  chartLoading: document.getElementById("chartLoading"),
  chartCanvas: document.getElementById("chart")
};

function formatMoney(value, compact = false) {
  if (value == null || Number.isNaN(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: value >= 1000 ? 0 : 2
  }).format(value);
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function selectedMeta() {
  return COINS.find(c => c.id === state.selectedCoin) || COINS[0];
}

function selectedCoinData() {
  return state.marketData.find(c => c.id === state.selectedCoin);
}

function chartKey(coinId = state.selectedCoin, days = state.selectedDays) {
  return `${coinId}_${days}`;
}

function showChartLoading(show) {
  els.chartLoading.classList.toggle("hidden", !show);
}

function getScores(coin) {
  const change = coin?.price_change_percentage_24h ?? 0;
  let buy = 50;
  let sell = 50;

  if (change <= -10) { buy += 28; sell -= 20; }
  else if (change <= -6) { buy += 18; sell -= 12; }
  else if (change <= -3) { buy += 10; sell -= 6; }
  else if (change >= 10) { buy -= 22; sell += 26; }
  else if (change >= 6) { buy -= 14; sell += 18; }
  else if (change >= 3) { buy -= 8; sell += 10; }

  if ((coin?.market_cap_rank ?? 999) <= 10) {
    buy += 6;
    sell -= 2;
  }

  if ((coin?.total_volume ?? 0) > 1000000000) {
    buy += 4;
  }

  return {
    buy: Math.max(0, Math.min(100, Math.round(buy))),
    sell: Math.max(0, Math.min(100, Math.round(sell)))
  };
}

function getSignalLabel(scores) {
  if (scores.buy >= 72) return "Buy Zone";
  if (scores.buy >= 60) return "Watch for Entry";
  if (scores.sell >= 72) return "Take Profit";
  if (scores.sell >= 60) return "Reduce Risk";
  return "Hold / Neutral";
}

function getActionBias(scores) {
  if (scores.buy - scores.sell >= 12) return "Leaning Buy";
  if (scores.sell - scores.buy >= 12) return "Leaning Sell";
  return "Balanced";
}

function getGuidance(coin, scores) {
  const change = coin?.price_change_percentage_24h ?? 0;
  if (scores.buy >= 72) return `${coin.name} has pulled back sharply and now reads as a stronger buy setup on this model. It does not guarantee the bottom, but it suggests the recent weakness may be worth watching for entries.`;
  if (scores.buy >= 60) return `${coin.name} looks more attractive than usual for buying, but the signal is not extreme. This is a watchlist setup rather than an aggressive all-in moment.`;
  if (scores.sell >= 72) return `${coin.name} looks stretched after recent strength. This model reads it as more of a take-profit zone than a fresh buy.`;
  if (scores.sell >= 60) return `${coin.name} is leaning overheated after recent gains. It may be better for caution, trimming, or waiting for a better entry.`;
  if (Math.abs(change) < 2) return `${coin.name} is relatively neutral right now. Momentum is not extreme either way, so patience and monitoring may be better than chasing price.`;
  return `${coin.name} is in a mixed zone. Trend and momentum are not strongly aligned, so waiting for a clearer setup is usually safer.`;
}

async function fetchMarketData() {
  const ids = COINS.map(c => c.id).join(",");
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=24h`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Failed to load market data");
  return await response.json();
}

async function fetchChartData(coinId, days) {
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load chart data for ${coinId}_${days}`);
  const data = await response.json();
  state.chartCache[chartKey(coinId, days)] = data;
  return data;
}

function buildLabels(prices, days) {
  return prices.map(([ts]) => {
    const d = new Date(ts);
    if (Number(days) === 1) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    if (Number(days) === 7) {
      return d.toLocaleDateString([], { weekday: "short", day: "2-digit" });
    }
    return d.toLocaleDateString([], { day: "2-digit", month: "short" });
  });
}

function updateSelectedPanels() {
  const meta = selectedMeta();
  const coin = selectedCoinData();
  if (!coin) return;

  const scores = getScores(coin);
  const change = coin.price_change_percentage_24h ?? 0;

  els.selectedAssetName.textContent = meta.name;
  els.signalPill.textContent = getSignalLabel(scores);
  els.actionBias.textContent = getActionBias(scores);
  els.buyScore.textContent = `${scores.buy}/100`;
  els.sellScore.textContent = `${scores.sell}/100`;
  els.change24h.textContent = formatPercent(change);
  els.change24h.className = "insight-value " + (change > 0 ? "positive" : change < 0 ? "negative" : "neutral");
  els.guidanceText.textContent = getGuidance(coin, scores);

  els.metricPrice.textContent = formatMoney(coin.current_price);
  els.metricMarketCap.textContent = formatMoney(coin.market_cap, true);
  els.metricVolume.textContent = formatMoney(coin.total_volume, true);
  els.metricRank.textContent = "#" + (coin.market_cap_rank ?? "--");
  els.chartTitle.textContent = `${meta.symbol} Chart`;
}

function renderCoinCards() {
  els.coinGrid.innerHTML = "";
  for (const coin of state.marketData) {
    const scores = getScores(coin);
    const status = getSignalLabel(scores);
    const isPositive = (coin.price_change_percentage_24h ?? 0) >= 0;
    const isActive = coin.id === state.selectedCoin;

    const card = document.createElement("button");
    card.type = "button";
    card.className = `coin-card${isActive ? " active" : ""}`;
    card.innerHTML = `
      <div class="coin-top">
        <h3>${coin.symbol.toUpperCase()}</h3>
        <span class="status-pill">${status}</span>
      </div>
      <div class="price">${formatMoney(coin.current_price)}</div>
      <div class="${isPositive ? "positive" : "negative"}">${formatPercent(coin.price_change_percentage_24h ?? 0)}</div>
      <div class="mini-meta">Buy ${scores.buy}/100 · Sell ${scores.sell}/100</div>
    `;
    card.addEventListener("click", async () => {
      state.selectedCoin = coin.id;
      renderCoinCards();
      updateSelectedPanels();
      await renderSelectedChart(true);
      prefetchCurrentCoinRanges();
    });
    els.coinGrid.appendChild(card);
  }
}

function createGradient(ctx) {
  const gradient = ctx.createLinearGradient(0, 0, 0, 320);
  gradient.addColorStop(0, "rgba(176, 38, 255, 0.34)");
  gradient.addColorStop(1, "rgba(176, 38, 255, 0.02)");
  return gradient;
}

function renderChartFromData(chartData) {
  const prices = chartData?.prices || [];
  const labels = buildLabels(prices, state.selectedDays);
  const values = prices.map(p => p[1]);
  const meta = selectedMeta();

  const ctx = els.chartCanvas.getContext("2d");
  const gradient = createGradient(ctx);

  if (state.chart) state.chart.destroy();

  state.chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: `${meta.symbol} Price`,
        data: values,
        borderColor: "#b026ff",
        backgroundColor: gradient,
        borderWidth: 3,
        tension: 0.32,
        fill: true,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: "#ffffff",
        pointHoverBorderColor: "#b026ff",
        pointHoverBorderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#0f0f14",
          titleColor: "#ffffff",
          bodyColor: "#d4d4d8",
          borderColor: "rgba(176, 38, 255, 0.35)",
          borderWidth: 1,
          displayColors: false,
          callbacks: {
            label: (context) => `$${context.parsed.y.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
          }
        }
      },
      scales: {
        x: {
          ticks: { color: "#a1a1aa", maxTicksLimit: 8 },
          grid: { color: "rgba(255,255,255,0.04)" },
          border: { display: false }
        },
        y: {
          ticks: {
            color: "#a1a1aa",
            callback: (value) => "$" + Number(value).toLocaleString()
          },
          grid: { color: "rgba(255,255,255,0.04)" },
          border: { display: false }
        }
      }
    }
  });
}

async function renderSelectedChart(forceRefresh = false) {
  const token = ++state.chartRequestToken;
  const key = chartKey();
  const cached = state.chartCache[key];

  if (cached) {
    renderChartFromData(cached);
  }

  showChartLoading(!cached);

  if (!cached || forceRefresh) {
    try {
      const data = await fetchChartData(state.selectedCoin, state.selectedDays);
      if (token !== state.chartRequestToken) return;
      renderChartFromData(data);
    } catch (error) {
      console.error(error);
      if (!cached) {
        els.lastUpdated.textContent = "Last updated: chart delayed";
      }
    } finally {
      if (token === state.chartRequestToken) {
        showChartLoading(false);
      }
    }
  } else {
    showChartLoading(false);
    fetchChartData(state.selectedCoin, state.selectedDays)
      .then((data) => {
        if (token === state.chartRequestToken) renderChartFromData(data);
      })
      .catch(() => {});
  }
}

async function loadMarket() {
  try {
    state.marketData = await fetchMarketData();
    renderCoinCards();
    updateSelectedPanels();
    els.lastUpdated.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    console.error(error);
    els.lastUpdated.textContent = "Last updated: delayed";
  }
}

function bindTimeframes() {
  for (const btn of els.timeframeButtons) {
    btn.addEventListener("click", async () => {
      for (const b of els.timeframeButtons) b.classList.remove("active");
      btn.classList.add("active");
      state.selectedDays = Number(btn.dataset.days);
      await renderSelectedChart(true);
    });
  }
}

function prefetchCurrentCoinRanges() {
  const coinId = state.selectedCoin;
  [1, 7, 30].forEach(days => {
    const key = chartKey(coinId, days);
    if (!state.chartCache[key]) {
      fetchChartData(coinId, days).catch(() => {});
    }
  });
}

async function init() {
  bindTimeframes();

  els.refreshBtn.addEventListener("click", async () => {
    await loadMarket();
    await renderSelectedChart(true);
  });

  await loadMarket();
  await renderSelectedChart(true);
  prefetchCurrentCoinRanges();

  setInterval(async () => {
    await loadMarket();
    await renderSelectedChart(false);
  }, 30000);
}

init();
