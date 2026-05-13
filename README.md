# 🃏 AirPoker  
**Play Texas Hold’em anywhere, your way.**

AirPoker is a lightweight, browser-based webapp designed to simplify poker games with friends.  
Choose your style: use **real cards** and your phone as the betting system, or go **fully virtual** with automated dealing and showdown evaluation.
No chips, no physical counters, no complicated setups. Just open the link, join the table, and play.

---

## 🚀 Features

### 🎮 Seamless Gameplay
- Anonymous login: enter a name and you're ready.
- Create or join a table via:
  - Password  
  - Shareable link  
  - QR code
- Lobby with real-time player list and drag-and-drop seat ordering (Spotify queue-style).

### 💰 Smart Betting Engine
- Automatic blinds rotation (SB/BB) each hand.
- Configurable buy-in and blind amounts.
- Turn-based betting:
  - Fold  
  - Check  
  - Call  
  - Bet / Raise  
  - All-in
- Automatic pot calculation, including **side pots**.

### 🃏 Hybrid Card Modes
AirPoker gives you total flexibility:
- **Physical Cards Mode**: Use a real deck of cards. The app manages turn ordering, blind posting, betting, and pot distribution. Winners are selected via a voting system or host override.
- **Virtual Cards Mode**: The app handles everything. Automated dealing, **professional "burn cards" protocol**, and a high-precision evaluation engine that automatically settles main and side pots at showdown.

### 🏆 Pro Showdown Engine
- **Automated Hand Evaluation**: High-precision detection of all poker combinations (High Card to Royal Flush).
- **Sequential Side-Pot Settlement**: Correct handling of complex multi-way all-ins with clear per-player winning summaries.
- **Visual Clarity**: Showdown modal with scrollable hand lists and interactive board views.

---

## 👑 Winner Confirmation System
At the end of the final betting round (River):
- The table enters winner-voting mode.
- Each active player selects who won.
- When **50%+** of eligible players choose the same name:
  - The pot is awarded automatically.
- If needed, the host can manually override.

---

## 🎯 Re-Entry & Seat Management
- Players can join even after the game has started.
- Host can reorder seats between hands.
- Late-joining players start from the next hand with a fresh stack.

---

## 🧱 Tech Stack

### Frontend
- **React + TypeScript**
- **Vite**  
- **TailwindCSS**

### Backend & Realtime Sync
- **Firebase Authentication** (anonymous login)
- **Firestore** (real-time database)
- **Advanced Logic Utilities**:
  - `pokerEvaluator.ts`: Professional-grade hand ranking and tie-breaking.
  - `calculatePotsCore`: Cascading side-pot calculation with zero-loss rounding.
  - `autoEvaluateShowdown`: Automated chip distribution and state management.

### Hosting
- **Firebase Hosting**  
Single-page webapp accessible via any modern browser.

---

## 📁 Project Structure

airpoker/<br>
│<br>
├── frontend/ # React webapp<br>
│ ├── src/<br>
│ │ ├── components/ # UI components<br>
│ │ ├── hooks/ # Custom hooks (auth, tables, hands)<br>
│ │ ├── lib/ # Firebase setup and API helpers<br>
│ │ ├── styles/ # Global CSS / Tailwind<br>
│ │ └── App.tsx<br>
│ └── package.json<br>
│<br>
└── firebase/ # Firebase project (Firestore, Auth, Functions)<br>
├── functions/<br>
│ ├── src/<br>
│ │ ├── onActionCreated.ts<br>
│ │ └── onWinnerVotingUpdated.ts<br>
│ └── package.json<br>
├── firestore.rules<br>
├── firestore.indexes.json<br>
└── firebase.json<br>

---

## 🛠 Setup & Development

### 1. Clone the repo
git clone https://github.com/zeroxpapone/airpoker<br>
cd airpoker
### 2. Install frontend
bash<br>
Copy code<br>
cd frontend<br>
npm install<br>
npm run dev
### 3. Firebase
Create a Firebase project<br>
<br>
Enable:<br>
<br>
Anonymous Authentication<br>
<br>
Firestore<br>
<br>
Hosting<br>
<br>
Copy the config into frontend/src/lib/firebase.ts<br>

### 4. Local Testing & PRs
Run the app locally to test features, understand the architecture, or develop improvements. If you build something cool (e.g., UI themes or advanced statistics), feel free to open a Pull Request!
**Note:** You are NOT permitted to deploy your own public instance of AirPoker or use this codebase to create a competing product. See the LICENSE file.
---

## 🧪 Development Roadmap (MVP → Advanced)
COMPLETED
- Anonymous login & Create/join table
- Real-time Lobby + seat ordering
- Automatic Blinds rotation & New Hand popups
- Professional Side-pot system (Cascading)
- Automated Virtual Cards Engine + Showdown
- Host management tools (Re-entry, Force Fold, Reorder)

PLANNED
- Game history & replay
- Table presets & private modes
- Advanced tournament statistics

---

## 🤝 Contributing
Pull requests are welcome.
If you want to suggest new features like game history export or custom table themes, feel free to open an issue.

---

## 📜 License
**Custom Restrictive License.** 
The code is strictly open for educational viewing, local testing, and contributing to the official repository. You may **not** host, distribute, monetize, or use this codebase (or its database structure) to create your own competing platform or copycat website. See the `LICENSE` file for full details.

---

## 💡 Philosophy
AirPoker isn’t about replacing real poker.
It’s about removing the physical clutter while keeping the fun, chaos, and psychology of live games intact.
