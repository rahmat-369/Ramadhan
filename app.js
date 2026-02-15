/**
 * RAMADHAN LANTERN - APP LOGIC
 * v1.0.0
 */

// --- Global State ---
const App = {
    data: {
        profile: {},
        settings: {},
        records: {},
        reminders: {},
        prayerCache: {},
        todayPrayers: null,
        hijriDate: null,
        isRamadhan: false,
        manualUnlock: false
    },
    
    // --- Initialization ---
    init: async () => {
        App.loadLocalStorage();
        App.applyTheme();
        App.renderGlobalUI();
        App.setupRouting();
        
        await App.fetchPrayerTimes();
        await App.fetchMotivation();
        
        // Start Loops
        setInterval(App.updateTimeChecks, 60000); // Every minute
        App.updateTimeChecks();
        
        // Service Worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js');
        }
    },

    // --- Local Storage Management ---
    loadLocalStorage: () => {
        const defaultProfile = {
            name: "User", username: "user123", bio: "Target Ramadhan 2026: Konsisten!",
            avatar: { type: "preset", dataUrl: "https://i.top4top.io/p_3698bfuyh0.png" },
            goals: { quranPagesPerDay: 5, tarawihRakaatTarget: 8 },
            createdAt: new Date().toISOString()
        };
        const defaultSettings = { theme: "light", locationMode: "auto", manualCity: "Jakarta" };
        const defaultReminders = { enableSahurReminder: true };

        App.data.profile = JSON.parse(localStorage.getItem('ramadhan_profile')) || defaultProfile;
        App.data.settings = JSON.parse(localStorage.getItem('ramadhan_settings')) || defaultSettings;
        App.data.records = JSON.parse(localStorage.getItem('ramadhan_records')) || {};
        App.data.reminders = JSON.parse(localStorage.getItem('ramadhan_reminders')) || defaultReminders;
        App.data.prayerCache = JSON.parse(localStorage.getItem('ramadhan_prayer_cache')) || {};
    },

    save: () => {
        localStorage.setItem('ramadhan_profile', JSON.stringify(App.data.profile));
        localStorage.setItem('ramadhan_settings', JSON.stringify(App.data.settings));
        localStorage.setItem('ramadhan_records', JSON.stringify(App.data.records));
        localStorage.setItem('ramadhan_reminders', JSON.stringify(App.data.reminders));
        localStorage.setItem('ramadhan_prayer_cache', JSON.stringify(App.data.prayerCache));
    },

    // --- Data Fetching ---
    fetchPrayerTimes: async () => {
        const todayStr = new Date().toISOString().split('T')[0];
        // Check Cache
        const cacheKey = `ramadhan_prayer_cache_${todayStr}`;
        if (App.data.prayerCache[cacheKey]) {
            App.data.todayPrayers = App.data.prayerCache[cacheKey];
            App.checkHijriDate(App.data.todayPrayers);
            App.renderCurrentPage();
            return;
        }

        // Fetch API
        let url = `https://api.aladhan.com/v1/timingsByCity?city=${App.data.settings.manualCity}&country=Indonesia&method=11`;
        
        try {
            const res = await fetch(url);
            const json = await res.json();
            if (json.code === 200) {
                const timings = json.data.timings;
                // Add Imsak manually if not accurate from API, but API usually has it. 
                // Ensuring Imsak is 10 mins before Fajr for safety if API missing
                // json.data.timings.Imsak logic handled by API usually.
                
                App.data.prayerCache[cacheKey] = json.data;
                App.data.todayPrayers = json.data;
                App.save();
                App.checkHijriDate(json.data);
                App.renderCurrentPage();
            }
        } catch (e) {
            console.error("Prayer fetch failed", e);
            document.getElementById('welcome-card').innerHTML += '<p style="color:red; font-size:10px;">Offline Mode: Jadwal mungkin tidak akurat.</p>';
        }
    },

    fetchMotivation: async () => {
        // Only on Dashboard
        if (window.location.pathname !== '/' && window.location.pathname !== '/pages/index.html') return;
        
        const cacheKey = `ramadhan_motivation_${new Date().toISOString().split('T')[0]}`;
        const cached = localStorage.getItem(cacheKey);
        
        if (cached) {
            App.renderMotivation(JSON.parse(cached));
            return;
        }

        try {
            const res1 = await fetch('/api/kataislami');
            const res2 = await fetch('/api/motivasi-islam');
            const data1 = await res1.json();
            const data2 = await res2.json();
            
            const combined = {
                kata: data1.result || "Semangat Ramadhan!",
                motivasi: data2.result || {}
            };
            
            localStorage.setItem(cacheKey, JSON.stringify(combined));
            App.renderMotivation(combined);
        } catch (e) {
            console.log("Motivation API Error", e);
        }
    },

    checkHijriDate: (data) => {
        const hijri = data.date.hijri;
        App.data.hijriDate = `${hijri.day} ${hijri.month.en} ${hijri.year}`;
        // Check if Ramadan (Month 9)
        if (hijri.month.number === 9) {
            App.data.isRamadhan = true;
            document.getElementById('ramadhan-status').innerText = `Ramadhan Hari ke-${hijri.day}`;
        } else {
            App.data.isRamadhan = false;
            document.getElementById('ramadhan-status').innerText = `${hijri.day} ${hijri.month.en}`;
        }
    },

    // --- Logic & Anti-Lie System ---
    getRecord: (dateStr) => {
        if (!App.data.records[dateStr]) {
            App.data.records[dateStr] = {
                fasting: { status: "none_other", reason: "" },
                prayers: {
                    subuh: { done: false }, dzuhur: { done: false }, ashar: { done: false },
                    maghrib: { done: false }, isya: { done: false }
                },
                sunnah: { tarawih: { done: false }, quran: 0 },
                updatedAt: new Date().toISOString()
            };
        }
        return App.data.records[dateStr];
    },

    isPrayerTime: (prayerName) => {
        if (App.data.manualUnlock) return true;
        if (!App.data.todayPrayers) return true; // Fallback

        const now = new Date();
        const timeStr = App.data.todayPrayers.timings[prayerName]; // "04:50"
        if (!timeStr) return true; // Handling mismatched names

        const [hours, minutes] = timeStr.split(':');
        const prayerDate = new Date();
        prayerDate.setHours(hours, minutes, 0);

        return now >= prayerDate;
    },

    togglePrayer: (prayer) => {
        const today = new Date().toISOString().split('T')[0];
        const record = App.getRecord(today);
        
        // Map UI name to API name
        const apiMap = { 'subuh': 'Fajr', 'dzuhur': 'Dhuhr', 'ashar': 'Asr', 'maghrib': 'Maghrib', 'isya': 'Isha' };
        
        if (!App.isPrayerTime(apiMap[prayer])) {
            alert("Belum masuk waktu sholat! Tunggu waktunya atau gunakan 'Izinkan Manual' di bawah.");
            return;
        }

        record.prayers[prayer].done = !record.prayers[prayer].done;
        record.prayers[prayer].time = new Date().toLocaleTimeString();
        App.save();
        App.renderDashboard();
    },

    // --- UI Rendering ---
    renderGlobalUI: () => {
        // Theme
        if (App.data.settings.theme === 'dark') document.body.classList.add('dark-mode');
        
        // Drawer Logic
        document.getElementById('hamburger-btn').addEventListener('click', () => {
            document.getElementById('drawer').classList.add('open');
            document.getElementById('drawer-overlay').classList.add('open');
        });
        document.getElementById('drawer-overlay').addEventListener('click', () => {
            document.getElementById('drawer').classList.remove('open');
            document.getElementById('drawer-overlay').classList.remove('open');
        });

        // FAB Logic
        document.getElementById('fab-add').addEventListener('click', () => {
            App.openQuickAdd();
        });

        // Menu Actions
        document.getElementById('btn-reset').addEventListener('click', App.handleReset);
        document.getElementById('btn-darkmode').addEventListener('click', () => {
            App.data.settings.theme = App.data.settings.theme === 'dark' ? 'light' : 'dark';
            App.save();
            location.reload();
        });
    },

    renderCurrentPage: () => {
        const path = window.location.pathname;
        if (path === '/' || path.includes('index')) App.renderDashboard();
        else if (path.includes('history')) App.renderHistory();
        else if (path.includes('profile')) App.renderProfile();
        else if (path.includes('tools')) App.renderTools();
    },

    renderDashboard: () => {
        const today = new Date().toISOString().split('T')[0];
        const record = App.getRecord(today);
        
        // Welcome
        document.getElementById('welcome-date').innerText = new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        
        // Prayers
        const prayerList = ['subuh', 'dzuhur', 'ashar', 'maghrib', 'isya'];
        const apiMap = { 'subuh': 'Fajr', 'dzuhur': 'Dhuhr', 'ashar': 'Asr', 'maghrib': 'Maghrib', 'isya': 'Isha' };
        
        let prayerHTML = '';
        prayerList.forEach(p => {
            const isDone = record.prayers[p].done;
            const apiName = apiMap[p];
            const time = App.data.todayPrayers ? App.data.todayPrayers.timings[apiName] : '--:--';
            const locked = !App.isPrayerTime(apiName);
            
            prayerHTML += `
                <div class="toggle-row" style="opacity: ${locked ? 0.5 : 1}">
                    <div>
                        <div style="font-weight:600; text-transform:capitalize">${p}</div>
                        <div class="text-small">${time}</div>
                    </div>
                    <label class="switch">
                        <input type="checkbox" ${isDone ? 'checked' : ''} ${locked ? 'disabled' : ''} onchange="App.togglePrayer('${p}')">
                        <span class="slider"></span>
                    </label>
                </div>
            `;
        });
        document.getElementById('prayer-list').innerHTML = prayerHTML;
        
        // Update Fasting Status UI
        document.getElementById('fasting-status-display').innerText = record.fasting.status === 'ramadhan' ? 'Sedang Puasa' : 'Tidak Puasa';
    },

    renderHistory: () => {
        const list = document.getElementById('history-list');
        if(!list) return;
        
        const keys = Object.keys(App.data.records).sort().reverse();
        let html = '';
        
        keys.forEach(date => {
            const r = App.data.records[date];
            const doneCount = Object.values(r.prayers).filter(x => x.done).length;
            html += `
                <div class="card" onclick="App.openDayDetail('${date}')">
                    <div style="display:flex; justify-content:space-between; font-weight:bold;">
                        <span>${date}</span>
                        <span class="text-primary">${r.fasting.status === 'ramadhan' ? 'Puasa' : '-'}</span>
                    </div>
                    <div class="text-small">Sholat: ${doneCount}/5 | Quran: ${r.sunnah.quran || 0} hal</div>
                </div>
            `;
        });
        list.innerHTML = html || '<p class="text-center">Belum ada riwayat.</p>';
    },
    
    renderProfile: () => {
        if(!document.getElementById('profile-name')) return;
        const p = App.data.profile;
        document.getElementById('profile-name').innerText = p.name;
        document.getElementById('profile-bio').innerText = p.bio;
        document.getElementById('profile-avatar').src = p.avatar.dataUrl;
        
        // Simple Stats
        const totalDays = Object.keys(App.data.records).length;
        const fastingDays = Object.values(App.data.records).filter(r => r.fasting.status === 'ramadhan').length;
        
        document.getElementById('stat-fasting').innerText = `${fastingDays} Hari`;
        document.getElementById('stat-log').innerText = `${totalDays} Hari`;
    },
    
    renderTools: () => {
       if(!document.getElementById('imsakiyah-table')) return;
       // Render simple table of today's schedule
       if(App.data.todayPrayers) {
           const t = App.data.todayPrayers.timings;
           let html = `
            <div class="toggle-row"><span>Imsak</span> <b>${t.Imsak}</b></div>
            <div class="toggle-row"><span>Subuh</span> <b>${t.Fajr}</b></div>
            <div class="toggle-row"><span>Terbit</span> <b>${t.Sunrise}</b></div>
            <div class="toggle-row"><span>Dzuhur</span> <b>${t.Dhuhr}</b></div>
            <div class="toggle-row"><span>Ashar</span> <b>${t.Asr}</b></div>
            <div class="toggle-row"><span>Maghrib</span> <b>${t.Maghrib}</b></div>
            <div class="toggle-row"><span>Isya</span> <b>${t.Isha}</b></div>
           `;
           document.getElementById('imsakiyah-table').innerHTML = html;
       }
    },

    renderMotivation: (data) => {
        const container = document.getElementById('motivation-card');
        if(!container) return;
        
        const content = `
            <h3>Motivasi Hari Ini</h3>
            <p style="font-style:italic">"${data.kata.message || data.kata}"</p>
            <hr style="opacity:0.2">
            <p class="text-small"><b>${data.motivasi.arab || ''}</b></p>
            <p class="text-small">${data.motivasi.arti || ''}</p>
        `;
        container.innerHTML = content;
    },

    // --- Helpers ---
    openQuickAdd: () => {
        const modal = document.getElementById('modal-quick-add');
        modal.classList.add('active');
        
        // Close on click outside
        modal.onclick = (e) => {
            if(e.target === modal) modal.classList.remove('active');
        }
    },
    
    enableManual: () => {
        if(confirm("Izinkan override manual? Fitur ini untuk kondisi darurat jika jadwal tidak sesuai.")) {
            App.data.manualUnlock = true;
            App.renderDashboard();
            setTimeout(() => {
                App.data.manualUnlock = false;
                App.renderDashboard();
            }, 600000); // 10 mins
        }
    },
    
    handleReset: () => {
        const input = prompt("Ketik 'RESET' untuk menghapus semua data.");
        if(input === 'RESET') {
            localStorage.clear();
            location.reload();
        }
    },
    
    updateTimeChecks: () => {
        // Just re-render dashboard if on dashboard to update locks
        if(window.location.pathname === '/' || window.location.pathname.includes('index')) {
            App.renderDashboard();
        }
    }
};

// Start App
document.addEventListener('DOMContentLoaded', App.init);