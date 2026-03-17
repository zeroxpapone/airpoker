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

```text
airpoker/
│
├── frontend/              # React webapp
│   ├── src/
│   │   ├── components/    # UI components
│   │   ├── hooks/         # Custom hooks (auth, tables, hands)
│   │   ├── lib/           # Firebase setup and API helpers
│   │   ├── styles/        # Global CSS / Tailwind
│   │   └── App.tsx
│   └── package.json
│
└── firebase/              # Firebase project (Firestore, Auth, Functions)
    ├── functions/
    │   ├── src/
    │   │   ├── onActionCreated.ts
    │   │   └── onWinnerVotingUpdated.ts
    │   └── package.json
    ├── firestore.rules
    ├── firestore.indexes.json
    └── firebase.json
```

---

## 🛠 Setup & Development

### 1. Clone the repo

```bash
git clone https://github.com/zeroxpapone/airpoker
cd airpoker
```

### 2. Install frontend

```bash
cd frontend
npm install
npm run dev
```

### 3. Firebase

Create a Firebase project

Enable:

- Anonymous Authentication
- Firestore
- Hosting

Copy the config into `frontend/src/lib/firebase.ts`

### 4. Deploy

```bash
firebase deploy
```

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

MIT License. Free to use, modify, or adapt.

---

## 💡 Philosophy

AirPoker isn’t about replacing real poker.
It’s about removing the physical clutter while keeping the fun, chaos, and psychology of live games intact.
