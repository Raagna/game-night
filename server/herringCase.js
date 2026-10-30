// Red Herring's case file: the facts on the alibi cards, the roles, and dealing a case. Shared by the server
// (herring.js) and the screens (src/herring), so both name things the same way.

// Each alibi card has one fact from each category: where the guest was, what they were holding, and a mark on
// them. The killer's card is the crime.
export const CATEGORIES = ['room', 'item', 'mark']
export const CATEGORY_NAME = { room: 'Where', item: 'Holding', mark: 'Mark' }
export const FACTS = {
  room: [
    ['library', 'Library'], ['greenhouse', 'Greenhouse'], ['kitchen', 'Kitchen'], ['ballroom', 'Ballroom'],
    ['cellar', 'Wine Cellar'], ['study', 'Study'], ['gallery', 'Gallery'], ['chapel', 'Chapel'],
  ],
  item: [
    ['opener', 'Letter Opener'], ['poker', 'Fire Poker'], ['scarf', 'Silk Scarf'], ['watch', 'Pocket Watch'],
    ['teacup', 'Teacup'], ['cane', 'Walking Cane'], ['key', 'Brass Key'], ['shears', 'Garden Shears'],
  ],
  mark: [
    ['mud', 'Muddy Boots'], ['ink', 'Inky Fingers'], ['torn', 'Torn Sleeve'], ['smoke', 'Smell of Smoke'],
    ['scratch', 'Scratched Hand'], ['perfume', 'Strong Perfume'], ['wine', 'Wine Stain'], ['rain', 'Soaked Coat'],
  ],
}
const NAMES = Object.fromEntries(CATEGORIES.map((category) => [category, Object.fromEntries(FACTS[category])]))
export const factName = (category, value) => NAMES[category]?.[value] || value

export const ROLES = {
  detective: { name: 'Detective', team: 'detectives' },
  killer: { name: 'Killer', team: 'killer' },
  accomplice: { name: 'Accomplice', team: 'killer' },
  forensics: { name: 'Forensics', team: 'detectives' },
  witness: { name: 'Witness', team: 'detectives' },
  officer: { name: 'Officer', team: 'detectives' },
  coroner: { name: 'Coroner', team: 'detectives' },
  informant: { name: 'Informant', team: 'detectives' },
  // The Rookie is told they're Forensics; their findings are unreliable.
  rookie: { name: 'Rookie', team: 'detectives' },
  reporter: { name: 'Tabloid Reporter', team: 'reporter' },
}
// The roles a game can leave out, and how many players it takes before each one is dealt.
export const OPTIONAL_ROLES = { officer: 6, coroner: 7, reporter: 7, accomplice: 8, informant: 9, rookie: 10 }
export const DEFAULT_ROLES = { officer: true, coroner: true, reporter: true, accomplice: true, informant: true, rookie: false }
export const MIN_PLAYERS = 5
export const MAX_PLAYERS = 12
export const MAX_DAYS = 5

// The mansion's late owner, found dead on the first morning.
export const VICTIMS = ['Lord Ashcombe', 'Dame Violet Thorne', 'Colonel Graves', 'Lady Odette Finch', 'Sir Mortimer Vale', 'Countess Ilse Marrow']

// Fewer facts in play for a smaller party, so every fact is shared by two guests or more.
export const factsInPlay = (players) => (players <= 6 ? 3 : players <= 9 ? 4 : 5)

const shuffled = (list, random) => list.map((item) => [random(), item]).sort((a, b) => a[0] - b[0]).map(([, item]) => item)

// Deals the alibi cards. Every fact in play is on at least one card, as evenly as the party allows; the crime's
// facts are each shared by at least one innocent guest, and no innocent guest has all three.
export function dealCards(playerIds, killerId, random = Math.random) {
  const n = playerIds.length, k = factsInPlay(n)
  for (let attempt = 0; attempt < 200; attempt++) {
    const values = {}, crime = {}, cards = Object.fromEntries(playerIds.map((id) => [id, {}]))
    for (const category of CATEGORIES) {
      values[category] = shuffled(FACTS[category].map(([id]) => id), random).slice(0, k)
      const spread = shuffled(Array.from({ length: n }, (_, i) => values[category][i % k]), random)
      const shared = values[category].filter((value) => spread.filter((v) => v === value).length >= 2)
      crime[category] = shared[Math.floor(random() * shared.length)]
      const at = playerIds.indexOf(killerId), swap = spread.indexOf(crime[category])
      ;[spread[at], spread[swap]] = [spread[swap], spread[at]]
      playerIds.forEach((id, i) => { cards[id][category] = spread[i] })
    }
    const lookalike = playerIds.some((id) => id !== killerId && CATEGORIES.every((category) => cards[id][category] === crime[category]))
    if (!lookalike) return { values, crime, cards }
  }
  throw new Error('Couldn’t deal the alibi cards. Try again.')
}

// Who is dealt which role. The Killer, Forensics and the Witness are in every game; the others join as the party
// grows, if the host left them in.
export function dealRoles(playerIds, enabled = DEFAULT_ROLES, random = Math.random) {
  const order = shuffled(playerIds, random), roles = {}
  roles[order[0]] = 'killer'
  const extras = Object.keys(OPTIONAL_ROLES).filter((role) => enabled[role] && playerIds.length >= OPTIONAL_ROLES[role])
  ;['forensics', 'witness', ...extras].forEach((role, i) => { if (order[i + 1]) roles[order[i + 1]] = role })
  for (const id of order) roles[id] ||= 'detective'
  return roles
}

// The guest ledger: how many guests' cards carry each fact in play.
export function tally(values, cards) {
  return Object.fromEntries(CATEGORIES.map((category) => [category, values[category].map((value) => ({
    value, count: Object.values(cards).filter((card) => card?.[category] === value).length,
  }))]))
}
