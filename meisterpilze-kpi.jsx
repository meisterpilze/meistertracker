import { useState, useEffect } from "react";

const STORAGE_KEY = "meisterpilze_kpi_v1";

const TRACKING_LINKS = [
  { label: "Package Flyer (Etsy/eBay)", url: "https://bit.ly/paket", tag: "flyer" },
  { label: "Farmers Market Stand", url: "https://bit.ly/mpmarkt", tag: "market" },
  { label: "Instagram Bio", url: "https://bit.ly/mpio", tag: "instagram" },
];

const WEEK_TARGETS = {
  posts: 3,
  directOrders: 5,
  emailGrowth: 5,
};

const RESTAURANT_STAGES = ["Identified", "Sampled", "Followed Up", "Signed"];

const defaultState = () => ({
  startDate: new Date().toISOString().split("T")[0],
  emailListSize: 0,
  weeks: [],
  restaurants: [],
});

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaultState(), ...JSON.parse(raw) } : defaultState();
  } catch {
    return defaultState();
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function getWeekNumber(startDate) {
  const start = new Date(startDate);
  const now = new Date();
  const diff = Math.floor((now - start) / (7 * 24 * 60 * 60 * 1000));
  return Math.min(Math.max(diff + 1, 1), 13);
}

function WeekRow({ week, onUpdate }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "60px 1fr 1fr 1fr 1fr",
      gap: "8px",
      alignItems: "center",
      padding: "10px 12px",
      background: week.current ? "rgba(139, 195, 74, 0.08)" : "rgba(255,255,255,0.02)",
      borderRadius: "8px",
      border: week.current ? "1px solid rgba(139, 195, 74, 0.3)" : "1px solid rgba(255,255,255,0.05)",
      marginBottom: "6px",
    }}>
      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "11px", color: "#8bc34a", fontWeight: "700" }}>
        W{week.number}
      </div>
      {/* Posts */}
      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        <div style={{ fontSize: "10px", color: "#888", textTransform: "uppercase", letterSpacing: "0.5px" }}>Posts</div>
        <input
          type="number"
          min="0"
          max="20"
          value={week.posts ?? ""}
          onChange={e => onUpdate({ ...week, posts: parseInt(e.target.value) || 0 })}
          style={inputStyle(week.posts >= WEEK_TARGETS.posts)}
        />
      </div>
      {/* Direct Orders */}
      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        <div style={{ fontSize: "10px", color: "#888", textTransform: "uppercase", letterSpacing: "0.5px" }}>Orders</div>
        <input
          type="number"
          min="0"
          value={week.orders ?? ""}
          onChange={e => onUpdate({ ...week, orders: parseInt(e.target.value) || 0 })}
          style={inputStyle(week.orders >= WEEK_TARGETS.directOrders)}
        />
      </div>
      {/* Email Size */}
      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        <div style={{ fontSize: "10px", color: "#888", textTransform: "uppercase", letterSpacing: "0.5px" }}>Email List</div>
        <input
          type="number"
          min="0"
          value={week.emailSize ?? ""}
          onChange={e => onUpdate({ ...week, emailSize: parseInt(e.target.value) || 0 })}
          style={inputStyle(false)}
        />
      </div>
      {/* Restaurant contact */}
      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        <div style={{ fontSize: "10px", color: "#888", textTransform: "uppercase", letterSpacing: "0.5px" }}>Rest. Contact</div>
        <select
          value={week.restaurantContact ?? "no"}
          onChange={e => onUpdate({ ...week, restaurantContact: e.target.value })}
          style={{
            ...inputStyle(week.restaurantContact === "yes"),
            cursor: "pointer",
          }}
        >
          <option value="no">—</option>
          <option value="yes">✓ Done</option>
        </select>
      </div>
    </div>
  );
}

function inputStyle(isGood) {
  return {
    background: "rgba(255,255,255,0.05)",
    border: `1px solid ${isGood ? "rgba(139,195,74,0.5)" : "rgba(255,255,255,0.1)"}`,
    borderRadius: "6px",
    color: isGood ? "#8bc34a" : "#e0e0e0",
    fontSize: "13px",
    fontFamily: "'Space Mono', monospace",
    padding: "4px 8px",
    width: "100%",
    outline: "none",
    boxSizing: "border-box",
  };
}

function Stat({ label, value, sub, accent }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: "12px",
      padding: "16px",
      display: "flex",
      flexDirection: "column",
      gap: "4px",
    }}>
      <div style={{ fontSize: "11px", color: "#888", textTransform: "uppercase", letterSpacing: "1px" }}>{label}</div>
      <div style={{ fontSize: "28px", fontWeight: "800", color: accent || "#e0e0e0", fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: "11px", color: "#666" }}>{sub}</div>}
    </div>
  );
}

function ProgressBar({ value, max, color }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div style={{ height: "6px", background: "rgba(255,255,255,0.08)", borderRadius: "3px", overflow: "hidden" }}>
      <div style={{
        height: "100%",
        width: `${pct}%`,
        background: color || "#8bc34a",
        borderRadius: "3px",
        transition: "width 0.4s ease",
      }} />
    </div>
  );
}

export default function MeisterpilzeKPI() {
  const [state, setState] = useState(loadState);
  const [tab, setTab] = useState("dashboard");
  const [newRestaurant, setNewRestaurant] = useState({ name: "", stage: "Identified", notes: "" });
  const [showAddRest, setShowAddRest] = useState(false);

  const currentWeek = getWeekNumber(state.startDate);
  const totalDays = Math.floor((new Date() - new Date(state.startDate)) / (24 * 60 * 60 * 1000));
  const daysLeft = Math.max(90 - totalDays, 0);

  // Ensure weeks array has current week
  useEffect(() => {
    setState(prev => {
      const weeks = [...(prev.weeks || [])];
      if (!weeks.find(w => w.number === currentWeek)) {
        weeks.push({ number: currentWeek, current: true, posts: 0, orders: 0, emailSize: prev.emailListSize, restaurantContact: "no" });
      }
      return { ...prev, weeks: weeks.map(w => ({ ...w, current: w.number === currentWeek })) };
    });
  }, [currentWeek]);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const updateWeek = (updated) => {
    setState(prev => ({
      ...prev,
      weeks: prev.weeks.map(w => w.number === updated.number ? updated : w),
    }));
  };

  const totalPosts = state.weeks.reduce((s, w) => s + (w.posts || 0), 0);
  const totalOrders = state.weeks.reduce((s, w) => s + (w.orders || 0), 0);
  const signedRestaurants = (state.restaurants || []).filter(r => r.stage === "Signed").length;
  const latestEmail = state.weeks.length ? Math.max(...state.weeks.map(w => w.emailSize || 0)) : state.emailListSize;
  const postStreak = (() => {
    let streak = 0;
    const sorted = [...state.weeks].sort((a, b) => b.number - a.number);
    for (const w of sorted) {
      if ((w.posts || 0) >= WEEK_TARGETS.posts) streak++;
      else break;
    }
    return streak;
  })();

  const addRestaurant = () => {
    if (!newRestaurant.name.trim()) return;
    setState(prev => ({ ...prev, restaurants: [...(prev.restaurants || []), { ...newRestaurant, id: Date.now() }] }));
    setNewRestaurant({ name: "", stage: "Identified", notes: "" });
    setShowAddRest(false);
  };

  const updateRestaurantStage = (id, stage) => {
    setState(prev => ({ ...prev, restaurants: prev.restaurants.map(r => r.id === id ? { ...r, stage } : r) }));
  };

  const removeRestaurant = (id) => {
    setState(prev => ({ ...prev, restaurants: prev.restaurants.filter(r => r.id !== id) }));
  };

  const stageColor = { Identified: "#607d8b", Sampled: "#ff9800", "Followed Up": "#2196f3", Signed: "#8bc34a" };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0f1410",
      color: "#e0e0e0",
      fontFamily: "'DM Sans', sans-serif",
      padding: "0",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;800&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg, #1a2410 0%, #0f1a0a 100%)",
        borderBottom: "1px solid rgba(139,195,74,0.15)",
        padding: "20px 24px 0",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "20px" }}>
          <div>
            <div style={{ fontSize: "11px", color: "#8bc34a", letterSpacing: "3px", textTransform: "uppercase", marginBottom: "4px", fontFamily: "'Space Mono', monospace" }}>
              Meisterpilze
            </div>
            <h1 style={{ margin: 0, fontSize: "22px", fontWeight: "800", color: "#f5f5f5", lineHeight: 1.1 }}>
              90-Day Growth Dashboard
            </h1>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "28px", fontWeight: "700", color: daysLeft < 14 ? "#ff9800" : "#8bc34a", lineHeight: 1 }}>
              {daysLeft}
            </div>
            <div style={{ fontSize: "10px", color: "#666", textTransform: "uppercase", letterSpacing: "1px" }}>days left</div>
          </div>
        </div>

        {/* Progress bar 90 days */}
        <div style={{ marginBottom: "0", paddingBottom: "16px" }}>
          <ProgressBar value={totalDays} max={90} color="#8bc34a" />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
            <span style={{ fontSize: "10px", color: "#555" }}>Day {totalDays}</span>
            <span style={{ fontSize: "10px", color: "#555" }}>Day 90</span>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: "0" }}>
          {[["dashboard", "Overview"], ["weekly", "Weekly Log"], ["restaurants", "Restaurants"], ["links", "Tracking Links"]].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                background: "none",
                border: "none",
                borderBottom: tab === key ? "2px solid #8bc34a" : "2px solid transparent",
                color: tab === key ? "#8bc34a" : "#666",
                padding: "8px 16px",
                fontSize: "13px",
                fontWeight: tab === key ? "700" : "400",
                cursor: "pointer",
                fontFamily: "'DM Sans', sans-serif",
                transition: "color 0.2s",
              }}
            >{label}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: "20px 24px" }}>

        {/* DASHBOARD TAB */}
        {tab === "dashboard" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* KPI Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <Stat label="Total Posts" value={totalPosts} sub={`Target: ${currentWeek * WEEK_TARGETS.posts}`} accent={totalPosts >= currentWeek * WEEK_TARGETS.posts ? "#8bc34a" : "#ff9800"} />
              <Stat label="Email List" value={latestEmail} sub="Target: 200 by Day 90" accent="#64b5f6" />
              <Stat label="Direct Orders" value={totalOrders} sub={`This sprint`} accent="#ce93d8" />
              <Stat label="Restaurants Signed" value={signedRestaurants} sub="Target: 1 by Day 60" accent={signedRestaurants >= 1 ? "#8bc34a" : "#ff9800"} />
            </div>

            {/* Post streak */}
            <div style={{
              background: "rgba(139,195,74,0.06)",
              border: "1px solid rgba(139,195,74,0.2)",
              borderRadius: "12px",
              padding: "14px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}>
              <div>
                <div style={{ fontSize: "11px", color: "#8bc34a", textTransform: "uppercase", letterSpacing: "1px" }}>Post Streak</div>
                <div style={{ fontSize: "13px", color: "#aaa", marginTop: "2px" }}>Weeks hitting 3+ posts in a row</div>
              </div>
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "36px", fontWeight: "700", color: postStreak > 0 ? "#8bc34a" : "#555" }}>
                {postStreak}🔥
              </div>
            </div>

            {/* 3 Priorities */}
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "12px", padding: "16px" }}>
              <div style={{ fontSize: "11px", color: "#888", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "12px" }}>90-Day Priorities</div>
              {[
                { label: "Own Lion's Mane online", value: totalPosts, max: currentWeek * WEEK_TARGETS.posts, color: "#8bc34a", detail: `${totalPosts} posts published` },
                { label: "Build email list to 200", value: latestEmail, max: 200, color: "#64b5f6", detail: `${latestEmail} / 200 subscribers` },
                { label: "Land 1 trophy restaurant", value: signedRestaurants, max: 1, color: "#ff9800", detail: `${signedRestaurants} signed · ${(state.restaurants || []).length} in pipeline` },
              ].map(p => (
                <div key={p.label} style={{ marginBottom: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                    <span style={{ fontSize: "13px", fontWeight: "600" }}>{p.label}</span>
                    <span style={{ fontSize: "12px", color: "#666" }}>{p.detail}</span>
                  </div>
                  <ProgressBar value={p.value} max={p.max} color={p.color} />
                </div>
              ))}
            </div>

            {/* Monday Check-in reminder */}
            <div style={{
              background: "rgba(255,152,0,0.06)",
              border: "1px solid rgba(255,152,0,0.2)",
              borderRadius: "12px",
              padding: "14px 16px",
            }}>
              <div style={{ fontSize: "11px", color: "#ff9800", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "4px" }}>Monday Check-in — Week {currentWeek}</div>
              <div style={{ fontSize: "13px", color: "#aaa", lineHeight: "1.6" }}>
                3 questions only: Did I post 3x? Did the email list grow? Did I contact a restaurant?<br />
                Log it in <strong style={{ color: "#e0e0e0" }}>Weekly Log</strong> → takes 2 minutes.
              </div>
            </div>
          </div>
        )}

        {/* WEEKLY LOG TAB */}
        {tab === "weekly" && (
          <div>
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "13px", color: "#888", marginBottom: "12px" }}>
                Log each Monday. Posts = Instagram/content published. Orders = direct website orders. Email List = current total. Restaurant Contact = did you reach out to at least one restaurant this week?
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr 1fr 1fr", gap: "8px", padding: "4px 12px", marginBottom: "4px" }}>
                {["Week", "Posts (≥3)", "Orders (≥5)", "Email Size", "Restaurant"].map(h => (
                  <div key={h} style={{ fontSize: "10px", color: "#555", textTransform: "uppercase", letterSpacing: "0.5px" }}>{h}</div>
                ))}
              </div>
              {[...state.weeks].sort((a, b) => b.number - a.number).map(week => (
                <WeekRow key={week.number} week={week} onUpdate={updateWeek} />
              ))}
            </div>
            <div style={{ marginTop: "16px", padding: "14px", background: "rgba(255,255,255,0.02)", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontSize: "11px", color: "#888", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "8px" }}>Starting Email List Size</div>
              <input
                type="number"
                value={state.emailListSize}
                onChange={e => setState(prev => ({ ...prev, emailListSize: parseInt(e.target.value) || 0 }))}
                style={{ ...inputStyle(false), width: "120px" }}
              />
            </div>
          </div>
        )}

        {/* RESTAURANTS TAB */}
        {tab === "restaurants" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div style={{ fontSize: "13px", color: "#888" }}>Track your restaurant pipeline. Target: 1 signed by Day 60.</div>
              <button
                onClick={() => setShowAddRest(!showAddRest)}
                style={{
                  background: "#8bc34a",
                  border: "none",
                  borderRadius: "8px",
                  color: "#0f1410",
                  fontSize: "13px",
                  fontWeight: "700",
                  padding: "8px 14px",
                  cursor: "pointer",
                }}
              >+ Add</button>
            </div>

            {showAddRest && (
              <div style={{ background: "rgba(139,195,74,0.06)", border: "1px solid rgba(139,195,74,0.2)", borderRadius: "12px", padding: "16px", marginBottom: "16px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <input
                    placeholder="Restaurant name"
                    value={newRestaurant.name}
                    onChange={e => setNewRestaurant(p => ({ ...p, name: e.target.value }))}
                    style={{ ...inputStyle(false), fontSize: "14px", padding: "8px 12px" }}
                  />
                  <select
                    value={newRestaurant.stage}
                    onChange={e => setNewRestaurant(p => ({ ...p, stage: e.target.value }))}
                    style={{ ...inputStyle(false), fontSize: "14px", padding: "8px 12px", cursor: "pointer" }}
                  >
                    {RESTAURANT_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <input
                    placeholder="Notes (optional)"
                    value={newRestaurant.notes}
                    onChange={e => setNewRestaurant(p => ({ ...p, notes: e.target.value }))}
                    style={{ ...inputStyle(false), fontSize: "13px", padding: "8px 12px" }}
                  />
                  <button
                    onClick={addRestaurant}
                    style={{ background: "#8bc34a", border: "none", borderRadius: "8px", color: "#0f1410", fontSize: "13px", fontWeight: "700", padding: "10px", cursor: "pointer" }}
                  >Add Restaurant</button>
                </div>
              </div>
            )}

            {/* Stage summary */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px", marginBottom: "16px" }}>
              {RESTAURANT_STAGES.map(stage => {
                const count = (state.restaurants || []).filter(r => r.stage === stage).length;
                return (
                  <div key={stage} style={{ background: "rgba(255,255,255,0.03)", borderRadius: "8px", padding: "10px", textAlign: "center", border: `1px solid ${stageColor[stage]}30` }}>
                    <div style={{ fontSize: "20px", fontWeight: "800", color: stageColor[stage], fontFamily: "'Space Mono', monospace" }}>{count}</div>
                    <div style={{ fontSize: "10px", color: "#666", textTransform: "uppercase", letterSpacing: "0.5px" }}>{stage}</div>
                  </div>
                );
              })}
            </div>

            {/* Restaurant list */}
            {(state.restaurants || []).length === 0 ? (
              <div style={{ textAlign: "center", color: "#555", fontSize: "14px", padding: "32px" }}>
                No restaurants yet. Add your first target above.
              </div>
            ) : (
              [...state.restaurants].map(r => (
                <div key={r.id} style={{
                  background: "rgba(255,255,255,0.02)",
                  border: `1px solid ${stageColor[r.stage]}30`,
                  borderLeft: `3px solid ${stageColor[r.stage]}`,
                  borderRadius: "10px",
                  padding: "12px 14px",
                  marginBottom: "8px",
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: "600", fontSize: "14px" }}>{r.name}</div>
                    {r.notes && <div style={{ fontSize: "12px", color: "#666", marginTop: "2px" }}>{r.notes}</div>}
                  </div>
                  <select
                    value={r.stage}
                    onChange={e => updateRestaurantStage(r.id, e.target.value)}
                    style={{
                      background: `${stageColor[r.stage]}20`,
                      border: `1px solid ${stageColor[r.stage]}50`,
                      borderRadius: "6px",
                      color: stageColor[r.stage],
                      fontSize: "12px",
                      padding: "4px 8px",
                      cursor: "pointer",
                      fontWeight: "600",
                    }}
                  >
                    {RESTAURANT_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button
                    onClick={() => removeRestaurant(r.id)}
                    style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: "16px", padding: "0 4px" }}
                  >×</button>
                </div>
              ))
            )}
          </div>
        )}

        {/* TRACKING LINKS TAB */}
        {tab === "links" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ fontSize: "13px", color: "#888", marginBottom: "4px" }}>
              These Bitly links are live and tracking clicks. Use each one in its specific placement so you can see which channel drives the most conversions.
            </div>
            {TRACKING_LINKS.map(link => (
              <div key={link.url} style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: "12px",
                padding: "16px",
              }}>
                <div style={{ fontSize: "11px", color: "#8bc34a", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "6px" }}>{link.label}</div>
                <div style={{
                  fontFamily: "'Space Mono', monospace",
                  fontSize: "16px",
                  fontWeight: "700",
                  color: "#e0e0e0",
                  marginBottom: "8px",
                }}>{link.url}</div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <a
                    href={`https://app.bitly.com/`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      fontSize: "12px",
                      color: "#64b5f6",
                      textDecoration: "none",
                      background: "rgba(100,181,246,0.1)",
                      padding: "4px 10px",
                      borderRadius: "6px",
                      border: "1px solid rgba(100,181,246,0.2)",
                    }}
                  >View stats in Bitly →</a>
                </div>
              </div>
            ))}
            <div style={{
              background: "rgba(255,152,0,0.05)",
              border: "1px solid rgba(255,152,0,0.2)",
              borderRadius: "12px",
              padding: "14px 16px",
              fontSize: "13px",
              color: "#aaa",
              lineHeight: "1.6",
            }}>
              <strong style={{ color: "#ff9800" }}>How to use:</strong><br />
              <strong style={{ color: "#e0e0e0" }}>bit.ly/paket</strong> → Print on your package flyer insert (Etsy/eBay orders)<br />
              <strong style={{ color: "#e0e0e0" }}>bit.ly/mpmarkt</strong> → QR code for your farmers market stand<br />
              <strong style={{ color: "#e0e0e0" }}>bit.ly/mpio</strong> → Instagram bio link<br /><br />
              Check Bitly analytics weekly to see which channel converts best.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
