# 🃏 AirPoker  
**Play Texas Hold’em anywhere using real cards and your phone as the betting system.**

AirPoker is a lightweight, browser-based webapp designed to simplify live poker games with friends.  
No chips, no physical counters, no complicated setups.  
Just open the link, join the table, and manage every betting round digitally.

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

### 🃏 Pure Physical Cards
AirPoker doesn't simulate cards.  
You use real cards.  
The app manages:
- Turn ordering  
- Blind posting  
- Betting  
- Pot distribution  
- Winner confirmation

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
- **Cloud Functions** for:
  - Validating betting actions  
  - Managing hand progression  
  - Calculating main + side pots  
  - Awarding winnings  
  - Enforcing table rules

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
Run the app locally to test features, understand the architecture, or develop improvements. If you build something cool (e.g., side pot improvements), feel free to open a Pull Request!
**Note:** You are NOT permitted to deploy your own public instance of AirPoker or use this codebase to create a competing product. See the LICENSE file.
---

## 🧪 Development Roadmap (MVP → Advanced)
MVP
Anonymous login

Create/join table

Lobby + ready check

First hand management (SB/BB, turn order, pot)

Basic betting flow

Winner selection screen

Extended
Side pot system

Re-entry handling

Host seat rearrangement

Host override tools

Game history & replay

Table presets & private modes

---

## 🤝 Contributing
Pull requests are welcome.
If you want to improve logic such as side pot calculation or add new features, feel free to open an issue.

---

## 📜 License
**Custom Restrictive License.** 
The code is strictly open for educational viewing, local testing, and contributing to the official repository. You may **not** host, distribute, monetize, or use this codebase (or its database structure) to create your own competing platform or copycat website. See the `LICENSE` file for full details.

---

## 💡 Philosophy
AirPoker isn’t about replacing real poker.
It’s about removing the physical clutter while keeping the fun, chaos, and psychology of live games intact.
