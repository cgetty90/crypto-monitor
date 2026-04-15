const COINS = [
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum" },
  { id: "solana", symbol: "SOL", name: "Solana" }
];

let selectedCoin = "bitcoin";
let selectedDays = 30;
let chart = null;
let marketDataCache = [];

const coinGrid = document.getElementById("coinGrid");
const chartTitle = document.getElementById("chartTitle");
const refreshBtn = document.getElementById("refreshBtn");
const lastUpdated = document.getElementById("lastUpdated");

async function fetchMarketData() {
  const ids = COINS.map(c => c.id).join(",");
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=24h`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load market data");
  }
  return await response.json();
}

async function fetchChartData(coinId, days) {
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load chart data");
  }
  return await response.json();
}

function getStatus(score) {
  if (score >= 75) return "Strong Buy Zone";
  if (score >= 60) return "Buy Zone";
  if (score >= 45) return "Hold / Watch";
  if (score >= 30) return "Take Profit";
  return "Reduce Risk";
}

function calculateScore(coin) {
  let score = 50;

  const change = coin.price_change_percentage_24h ?? 0;

  if (change < -8) score += 20;
  else if (change < -4) score += 10;
  else if (change > 8) score -= 20;
  else if (change > 4) score -= 10;

  if (coin.market_cap_rank <= 10) score += 10;
  if (coin.total_volume > 1000000000) score += 10;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function renderCoins(data) {
  coinGrid.innerHTML = "";

  data.forEach((coin) => {
    const score = calculateScore(coin);
    const status = getStatus(score);
    const isPositive = (coin.price_change_percentage_24h ?? 0) >= 0;
    const isActive = coin.id === selectedCoin;

    const card = document.createElement("button");
    card.className = `coin-card ${isActive ? "active" : ""}`;

    card.innerHTML = `
      <div class="coin-top">
        <h3>${coin.symbol.toUpperCase()}</h3>
        <span class="status-pill">${status}</span>
      </div>
      <div class="price">$${coin.current_price.toLocaleString()}</div>
      <div class="${isPositive ? "positive" : "negative"}">
        ${isPositive ? "+" : ""}${(coin.price_change_percentage_24h ?? 0).toFixed(2)}%
      </div>
      <div class="mini-meta">Score: ${score}/100</div>
    `;

    card.addEventListener("click", async () => {
      selectedCoin = coin.id;
      renderCoins(marketDataCache);
      await updateChart();
    });

    coinGrid.appendChild(card);
  });
}

function buildLabels(prices, days) {
  return prices.map((point) => {
    const d = new Date(point[0]);

    if (Number(days) === 1) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    return d.toLocaleDateString([], {
      day: "2-digit",
      month: "short"
    });
  });
}

async function updateChart() {
  const chartData = await fetchChartData(selectedCoin, selectedDays);
  const prices = chartData.prices || [];

  const labels = buildLabels(prices, selectedDays);
  const values = prices.map(point => point[1]);

  const coin = COINS.find(c => c.id === selectedCoin);
  chartTitle.textContent = `${coin.symbol} Chart`;

  const ctx = document.getElementById("chart").getContext("2d");

  if (chart) {
    chart.destroy();
  }

  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: `${coin.symbol} Price`,
          data: values,
          borderColor: "#b026ff",
          backgroundColor: "rgba(176, 38, 255, 0.15)",
          borderWidth: 3,
          tension: 0.35,
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: "#0f0f14",
          titleColor: "#ffffff",
          bodyColor: "#d4d4d8",
          borderColor: "rgba(176, 38, 255, 0.35)",
          borderWidth: 1,
          callbacks: {
            label: function(context) {
              return `$${context.parsed.y.toLocaleString(undefined, {
                maximumFractionDigits: 2
              })}`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: "#a1a1aa",
            maxTicksLimit: 8
          },
          grid: {
            color: "rgba(255,255,255,0.05)"
          }
        },
        y: {
          ticks: {
            color: "#a1a1aa",
            callback: function(value) {
              return "$" + Number(value).toLocaleString();
            }
          },
          grid: {
            color: "rgba(255,255,255,0.05)"
          }
        }
      }
    }
  });
}

async function loadApp() {
  try {
    marketDataCache = await fetchMarketData();
    renderCoins(marketDataCache);
    await updateChart();
    lastUpdated.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    console.error(error);
    lastUpdated.textContent = "Last updated: failed";
  }
}

function bindTimeframeButtons() {
  const buttons = document.querySelectorAll(".time-buttons button");

  buttons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      buttons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      selectedDays = Number(btn.dataset.days);
      await updateChart();
    });
  });
}

refreshBtn.addEventListener("click", loadApp);

bindTimeframeButtons();
loadApp();
setInterval(loadApp, 30000);