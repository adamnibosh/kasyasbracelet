/** Silver Italian charm catalog — 9mm modular links */
const CHARM_CATEGORIES = [
  { id: 'letters', label: 'Silver Letters', icon: 'A' },
  { id: 'love', label: 'Hearts & Love', icon: '♥' },
  { id: 'animals', label: 'Animals', icon: '🐱' },
  { id: 'symbols', label: 'Symbols & Patterns', icon: '✦' },
  { id: 'dangles', label: 'Dangles', icon: '◇' },
  { id: 'couples', label: 'Couples', icon: '∞' },
  { id: 'magnetic', label: 'Magnetic', icon: '⊕' },
  { id: 'keychains', label: 'Keychains', icon: '🔑' },
  { id: 'pop', label: 'Pop Culture', icon: '★' },
  { id: 'silver', label: 'Silver Basics', icon: '◻' },
  { id: 'collection', label: 'Full Collection', icon: '✦' },
];

const _BASE_CHARMS = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => ({
    id: `letter-${letter.toLowerCase()}`,
    name: `Silver Letter ${letter}`,
    shopLabel: `9mm Silver Letter "${letter}" Italian charm link`,
    category: 'letters',
    render: 'letter',
    letter,
    hint: 'Raised sterling silver letter on brushed silver base.',
  })),

  { id: 'heart-silver', name: 'Silver Heart', shopLabel: '9mm Silver Outline Heart Italian charm link', category: 'love', render: 'heart-silver', hint: 'Classic brushed silver heart outline.' },
  { id: 'heart-pink', name: 'Pink Heart', shopLabel: '9mm Pink Enamel Heart Italian charm link', category: 'love', render: 'heart-pink', hint: 'Soft pink enamel heart on silver.' },
  { id: 'heart-magnetic', name: 'Magnetic Heart', shopLabel: '9mm Magnetic Heart Italian charm link', category: 'love', render: 'heart-magnetic', dangling: true, hint: 'Heart charm with dangling accent piece.' },
  { id: 'infinity', name: 'Silver Infinity', shopLabel: '9mm Silver Infinity Italian charm link', category: 'love', render: 'infinity', hint: 'Etched infinity symbol in polished silver.' },
  { id: 'i-love-u', name: 'I ♥ U', shopLabel: '9mm "I Love U" Italian charm link', category: 'love', render: 'i-love-u', hint: 'Silver letters with enamel heart center.' },
  { id: 'bow-pink', name: 'Pink Bow', shopLabel: '9mm Pink Bow Italian charm link', category: 'love', render: 'bow-pink', dangling: true, hint: 'Pink ribbon bow with dangling chain.' },
  { id: 'bow-blue', name: 'Blue Bow', shopLabel: '9mm Blue Bow Italian charm link', category: 'love', render: 'bow-blue', dangling: true, hint: 'Blue ribbon bow with dangling chain.' },

  { id: 'kitten', name: 'Kitten', shopLabel: '9mm Kitten Italian charm link', category: 'animals', render: 'kitten', dangling: true, hint: 'Dangling kitten charm on silver link.' },
  { id: 'cat-black', name: 'Black Cat', shopLabel: '9mm Black Cat Italian charm link', category: 'animals', render: 'cat-black', hint: 'Black cat silhouette on silver face.' },
  { id: 'butterfly', name: 'Blue Butterfly', shopLabel: '9mm Blue Butterfly Italian charm link', category: 'animals', render: 'butterfly', dangling: true, hint: 'Blue butterfly with dangling chain.' },
  { id: 'jellyfish', name: 'Shell Dangle', shopLabel: '9mm Shell with Mother-of-Pearl Italian charm link', category: 'animals', render: 'jellyfish', dangling: true, hint: 'Mother-of-pearl shell on dangling silver link.' },

  { id: 'checkered-red', name: 'Red Checkered', shopLabel: '9mm Red Checkered Italian charm link', category: 'symbols', render: 'checkered-red', hint: 'Red and white gingham enamel pattern.' },
  { id: 'cherry', name: 'Cherry', shopLabel: '9mm Cherry Italian charm link', category: 'symbols', render: 'cherry', hint: 'Twin red cherries on silver.' },
  { id: 'bmw', name: 'BMW Logo', shopLabel: '9mm BMW Logo Italian charm link', category: 'symbols', render: 'bmw', hint: 'BMW roundel charm on silver base.' },
  { id: 'enamel-blue', name: 'Blue Enamel', shopLabel: '9mm Blue Enamel Italian charm link', category: 'symbols', render: 'enamel-blue', hint: 'Solid blue enamel on silver frame.' },
  { id: 'enamel-pink', name: 'Pink Enamel', shopLabel: '9mm Pink Enamel Italian charm link', category: 'symbols', render: 'enamel-pink', hint: 'Soft pink enamel on silver frame.' },
  { id: 'moon', name: 'Moon & Stars', shopLabel: '9mm Moon & Stars Italian charm link', category: 'symbols', render: 'moon', dangling: true, hint: 'Crescent moon with star accents.' },
  { id: 'flower', name: 'Pink Flower', shopLabel: '9mm Pink Flower Italian charm link', category: 'symbols', render: 'flower', hint: 'Delicate pink flower on silver.' },
  { id: 'star', name: 'Silver Star', shopLabel: '9mm Silver Star Italian charm link', category: 'symbols', render: 'star', hint: 'Outlined polished silver star.' },

  { id: 'blank-silver', name: 'Plain Silver Spacer', shopLabel: '9mm Plain Silver Italian charm link', category: 'silver', render: 'blank', hint: 'Brushed silver spacer link.' },
  { id: 'nameplate', name: 'Custom Name Plate', shopLabel: '9mm Custom Name Plate Italian charm link', category: 'silver', render: 'nameplate', hint: 'Engravable silver name plate link.' },
];

const CHARMS = [..._BASE_CHARMS, ...ZIP_CHARMS];

const CHARM_MAP = Object.fromEntries(CHARMS.map((c) => [c.id, c]));

const DEFAULT_BRACELET = [
  'blank-silver', 'letter-k', 'heart-silver', 'letter-a',
  'heart-pink', 'letter-s', 'letter-y', 'letter-a',
  'heart-silver', 'blank-silver',
];