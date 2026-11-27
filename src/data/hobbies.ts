/**
 * Curated Tinder-style Hobbies catalogue for Datevra.
 *
 * - Strictly separate from `src/data/interests.ts` and `src/data/lifestyle.ts`.
 * - 36 browsing categories (headings/filters only — never selectable hobbies).
 * - 350+ unique, specific hobby tags with zero case-insensitive duplicates.
 * - Supports minimum 3 / maximum 5 selection validation and legacy value preservation.
 */

export interface HobbyCategory {
  readonly id: string;
  readonly label: string;
  readonly items: readonly string[];
}

export const HOBBY_MIN_SELECTION = 3;
export const HOBBY_MAX_SELECTION = 5;
export const HOBBY_CUSTOM_MAX_LENGTH = 48;

export const HOBBY_CATEGORIES: readonly HobbyCategory[] = [
  {
    id: "sports-athletics",
    label: "Sports & Athletics",
    items: [
      "Cricket",
      "Football",
      "Badminton",
      "Tennis",
      "Basketball",
      "Volleyball",
      "Hockey",
      "Golf",
      "Table tennis",
      "Squash",
      "Swimming",
      "Boxing",
      "Wrestling",
      "Martial arts",
      "Running",
      "Marathon running",
      "Cycling",
      "Archery",
      "Skating",
    ],
  },
  {
    id: "fitness-exercise",
    label: "Fitness & Exercise",
    items: [
      "Yoga",
      "Pilates",
      "Strength training",
      "Weightlifting",
      "Calisthenics",
      "CrossFit",
      "Jogging",
      "Aerobics",
      "Zumba",
      "Home workouts",
      "Skipping rope",
      "Functional fitness",
      "HIIT training",
      "Mobility training",
    ],
  },
  {
    id: "outdoor-adventures",
    label: "Outdoor Adventures",
    items: [
      "Hiking",
      "Trekking",
      "Camping",
      "Mountain climbing",
      "Rock climbing",
      "Birdwatching",
      "Stargazing",
      "Fishing",
      "Nature walks",
      "Trail running",
      "Bouldering",
      "Geocaching",
      "Orienteering",
    ],
  },
  {
    id: "travel-exploration",
    label: "Travel & Exploration",
    items: [
      "Solo travel",
      "Backpacking",
      "Road trips",
      "International travel",
      "Exploring new cities",
      "Heritage walks",
      "Adventure travel",
      "Cultural tourism",
      "Train journeys",
      "Food tourism",
      "Weekend getaways",
      "Beach hopping",
    ],
  },
  {
    id: "music",
    label: "Music",
    items: [
      "Singing",
      "Guitar",
      "Piano",
      "Drums",
      "Violin",
      "Keyboard",
      "Music production",
      "DJing",
      "Songwriting",
      "Listening to live music",
      "Flute",
      "Tabla",
      "Ukulele",
      "Vinyl collecting",
      "Karaoke",
    ],
  },
  {
    id: "dance",
    label: "Dance",
    items: [
      "Bollywood dance",
      "Classical dance",
      "Hip-hop",
      "Salsa",
      "Contemporary dance",
      "Freestyle dancing",
      "Choreography",
      "Kathak",
      "Bharatanatyam",
      "Bachata",
      "Garba & Dandiya",
      "Bhangra",
    ],
  },
  {
    id: "art-painting",
    label: "Art & Painting",
    items: [
      "Sketching",
      "Drawing",
      "Watercolour painting",
      "Acrylic painting",
      "Oil painting",
      "Digital art",
      "Calligraphy",
      "Pottery",
      "Sculpture",
      "Charcoal drawing",
      "Mandala art",
      "Printmaking",
      "Mural painting",
    ],
  },
  {
    id: "photography-videography",
    label: "Photography & Videography",
    items: [
      "Street photography",
      "Portrait photography",
      "Landscape photography",
      "Wildlife photography",
      "Travel photography",
      "Film photography",
      "Video editing",
      "Filmmaking",
      "Astrophotography",
      "Drone videography",
      "Macro photography",
    ],
  },
  {
    id: "writing-literature",
    label: "Writing & Literature",
    items: [
      "Creative writing",
      "Poetry",
      "Journaling",
      "Blogging",
      "Storytelling",
      "Screenwriting",
      "Essay writing",
      "Short story writing",
      "Shayari writing",
      "Letter writing",
    ],
  },
  {
    id: "books-reading",
    label: "Books & Reading",
    items: [
      "Reading fiction",
      "Reading non-fiction",
      "Book clubs",
      "Biographies",
      "Mystery & thrillers",
      "Sci-fi & fantasy books",
      "Historical fiction",
      "Self-development books",
      "Graphic novels",
      "Audiobooks",
    ],
  },
  {
    id: "food-cooking",
    label: "Food & Cooking",
    items: [
      "Home cooking",
      "Indian cooking",
      "Experimenting with recipes",
      "Gourmet cooking",
      "Vegetarian cooking",
      "Food tasting",
      "Food blogging",
      "Grilling & BBQ",
      "Fermenting & pickling",
      "Pasta making",
      "Street food exploring",
    ],
  },
  {
    id: "baking-desserts",
    label: "Baking & Desserts",
    items: [
      "Cake baking",
      "Bread making",
      "Sourdough baking",
      "Pastry making",
      "Dessert making",
      "Chocolate making",
      "Cookie baking",
      "Cupcake decorating",
      "Indian mithai making",
    ],
  },
  {
    id: "coffee-tea",
    label: "Coffee & Tea",
    items: [
      "Coffee brewing",
      "Specialty coffee",
      "Espresso making",
      "Tea tasting",
      "Chai brewing",
      "Pour-over coffee",
      "Latte art",
      "Matcha preparation",
      "Café hopping",
    ],
  },
  {
    id: "games-gaming",
    label: "Games & Gaming",
    items: [
      "Mobile gaming",
      "PC gaming",
      "Console gaming",
      "Strategy games",
      "Multiplayer gaming",
      "Esports",
      "RPG gaming",
      "Racing simulators",
      "Retro gaming",
      "Indie games",
    ],
  },
  {
    id: "board-games-puzzles",
    label: "Board Games & Puzzles",
    items: [
      "Chess",
      "Carrom",
      "Ludo",
      "Sudoku",
      "Puzzles",
      "Trivia",
      "Scrabble",
      "Tabletop board games",
      "Crossword puzzles",
      "Rubik's Cube",
      "Card games",
      "Escape rooms",
    ],
  },
  {
    id: "movies-cinema",
    label: "Movies & Cinema",
    items: [
      "Film appreciation",
      "Movie marathons",
      "Independent films",
      "Classic cinema",
      "Documentaries",
      "Film discussions",
      "World cinema",
      "Regional cinema",
      "Film festivals",
    ],
  },
  {
    id: "tv-streaming",
    label: "TV & Streaming",
    items: [
      "Binge-watching series",
      "Crime & mystery shows",
      "Comedy specials",
      "Sitcoms",
      "Reality TV",
      "Sci-fi series",
      "Historical dramas",
      "K-dramas",
      "Sports broadcasts",
    ],
  },
  {
    id: "anime-comics",
    label: "Anime & Comics",
    items: [
      "Watching anime",
      "Reading manga",
      "Comic book collecting",
      "Superhero comics",
      "Cosplay",
      "Studio Ghibli films",
      "Fan art",
      "Webtoons",
    ],
  },
  {
    id: "technology-gadgets",
    label: "Technology & Gadgets",
    items: [
      "Coding",
      "Robotics",
      "Electronics",
      "3D printing",
      "App development",
      "AI experimentation",
      "Gadget collecting",
      "Smart home tinkering",
      "Open-source projects",
      "Mechanical keyboards",
      "PC building",
    ],
  },
  {
    id: "science-learning",
    label: "Science & Learning",
    items: [
      "Astronomy",
      "Psychology",
      "Philosophy",
      "Mathematics",
      "Science reading",
      "Educational courses",
      "Research",
      "Podcasts & lectures",
      "Space exploration",
      "Economics",
    ],
  },
  {
    id: "history-culture",
    label: "History & Culture",
    items: [
      "Indian history",
      "World history",
      "Mythology",
      "Archaeology",
      "Cultural exploration",
      "Museum visits",
      "Architecture appreciation",
      "Genealogy",
      "Folk traditions",
    ],
  },
  {
    id: "languages",
    label: "Languages",
    items: [
      "Learning languages",
      "Language exchange",
      "Translation",
      "Linguistics",
      "Sign language",
      "Etymology",
      "Foreign literature",
    ],
  },
  {
    id: "gardening-plants",
    label: "Gardening & Plants",
    items: [
      "Home gardening",
      "Indoor plants",
      "Bonsai",
      "Organic gardening",
      "Terrace gardening",
      "Flower arranging",
      "Herb gardening",
      "Succulents & cacti",
      "Composting",
    ],
  },
  {
    id: "animals-pets",
    label: "Animals & Pets",
    items: [
      "Dog training",
      "Pet care",
      "Horse riding",
      "Animal rescue",
      "Wildlife conservation",
      "Dog walking",
      "Aquarium keeping",
      "Cat care",
      "Pet photography",
    ],
  },
  {
    id: "fashion-styling",
    label: "Fashion & Styling",
    items: [
      "Fashion styling",
      "Sneaker collecting",
      "Vintage fashion",
      "Personal styling",
      "Clothing design",
      "Thrifting",
      "Sustainable fashion",
      "Streetwear",
      "Accessory styling",
    ],
  },
  {
    id: "beauty-self-care",
    label: "Beauty & Self-Care",
    items: [
      "Skincare routines",
      "Makeup artistry",
      "Nail art",
      "Aromatherapy",
      "Haircare styling",
      "Fragrance collecting",
      "Spa & grooming",
      "Holistic self-care",
    ],
  },
  {
    id: "crafting-diy",
    label: "Crafting & DIY",
    items: [
      "Woodworking",
      "Knitting",
      "Crochet",
      "Embroidery",
      "Sewing",
      "Handmade jewellery",
      "Home improvement",
      "Origami",
      "Candle making",
      "Resin art",
      "Soap making",
      "Upcycling",
    ],
  },
  {
    id: "collecting",
    label: "Collecting",
    items: [
      "Stamp collecting",
      "Coin collecting",
      "Watch collecting",
      "Art collecting",
      "Antique hunting",
      "Action figures",
      "Postcard collecting",
      "Rare books",
    ],
  },
  {
    id: "cars-motorcycles",
    label: "Cars & Motorcycles",
    items: [
      "Car detailing",
      "Automobile restoration",
      "Motorcycle touring",
      "Motorsport",
      "Automotive photography",
      "Weekend drives",
      "Off-roading",
      "Custom bike builds",
    ],
  },
  {
    id: "nature-wildlife",
    label: "Nature & Wildlife",
    items: [
      "Safari trips",
      "Forest walks",
      "Butterfly watching",
      "Marine life watching",
      "Nature journaling",
      "Conservation volunteering",
      "Botanical walks",
      "Sunrise & sunset chasing",
    ],
  },
  {
    id: "mindfulness-wellness",
    label: "Mindfulness & Spiritual Wellness",
    items: [
      "Meditation",
      "Mindfulness",
      "Breathwork",
      "Wellness routines",
      "Gratitude practice",
      "Sound healing",
      "Tai Chi",
      "Retreats & slow living",
    ],
  },
  {
    id: "social-community",
    label: "Social & Community Activities",
    items: [
      "Volunteering",
      "Community service",
      "Charity work",
      "Hosting gatherings",
      "Attending cultural events",
      "Book drives",
      "Environmental cleanups",
      "Cultural meetups",
    ],
  },
  {
    id: "adventure-water-sports",
    label: "Adventure & Water Sports",
    items: [
      "Scuba diving",
      "Snorkelling",
      "Surfing",
      "Kayaking",
      "Rafting",
      "Sailing",
      "Paragliding",
      "Skiing",
      "Snowboarding",
      "Paddleboarding",
      "Zip-lining",
      "Skydiving",
    ],
  },
  {
    id: "performing-arts",
    label: "Performing Arts",
    items: [
      "Acting",
      "Theatre",
      "Stand-up comedy",
      "Public speaking",
      "Magic",
      "Improv",
      "Spoken word",
      "Puppetry",
    ],
  },
  {
    id: "home-lifestyle",
    label: "Home & Lifestyle",
    items: [
      "Interior decorating",
      "Home organisation",
      "DIY décor",
      "Cooking for friends",
      "Collecting home accessories",
      "Minimalist living",
      "Table styling",
      "Entertaining guests",
    ],
  },
  {
    id: "entrepreneurship-professional",
    label: "Entrepreneurship & Professional Hobbies",
    items: [
      "Start-up building",
      "Side projects",
      "Mentoring",
      "Personal finance education",
      "Business reading",
      "Investing & markets",
      "Product design",
      "Networking events",
      "Career coaching",
    ],
  },
];

export const ALL_HOBBY_OPTIONS: readonly string[] = HOBBY_CATEGORIES.flatMap(
  (category) => category.items,
);

const CANONICAL_HOBBY_BY_LOWER = new Map<string, string>(
  ALL_HOBBY_OPTIONS.map((item) => [item.toLowerCase(), item]),
);

export function normalizeHobbyValue(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * Matches an existing/legacy saved hobby value to its canonical catalogue
 * spelling if present; otherwise preserves the trimmed original value cleanly.
 */
export function matchCanonicalHobby(raw: string): string {
  const cleaned = normalizeHobbyValue(raw);
  if (!cleaned) return "";
  return CANONICAL_HOBBY_BY_LOWER.get(cleaned.toLowerCase()) ?? cleaned;
}

/**
 * Normalizes and case-insensitively deduplicates a list of saved hobbies while
 * strictly preserving the original selection order (first selected stays first).
 */
export function normalizeSavedHobbies(list: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const mapped = matchCanonicalHobby(raw);
    if (!mapped) continue;
    const key = mapped.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mapped);
  }
  return out;
}

export function isCatalogHobby(hobby: string): boolean {
  const cleaned = normalizeHobbyValue(hobby).toLowerCase();
  return cleaned.length > 0 && CANONICAL_HOBBY_BY_LOWER.has(cleaned);
}

export interface HobbyValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
  readonly count: number;
  readonly remainingToMin: number;
  readonly remainingToMax: number;
}

export function validateHobbySelection(selected: readonly string[]): HobbyValidationResult {
  const count = selected.length;
  const remainingToMin = Math.max(0, HOBBY_MIN_SELECTION - count);
  const remainingToMax = Math.max(0, HOBBY_MAX_SELECTION - count);

  if (count < HOBBY_MIN_SELECTION) {
    return {
      valid: false,
      reason: `Please select at least ${HOBBY_MIN_SELECTION} hobbies (${remainingToMin} more required).`,
      count,
      remainingToMin,
      remainingToMax,
    };
  }
  if (count > HOBBY_MAX_SELECTION) {
    const excess = count - HOBBY_MAX_SELECTION;
    return {
      valid: false,
      reason: `You can select up to ${HOBBY_MAX_SELECTION} hobbies (remove ${excess} to save).`,
      count,
      remainingToMin,
      remainingToMax,
    };
  }
  return {
    valid: true,
    count,
    remainingToMin: 0,
    remainingToMax,
  };
}

export function searchHobbies(query: string, categoryId?: string): string[] {
  const q = normalizeHobbyValue(query).toLowerCase();
  const out: string[] = [];
  for (const cat of HOBBY_CATEGORIES) {
    if (categoryId && categoryId !== "all" && cat.id !== categoryId) continue;
    const catMatches = q.length > 0 && cat.label.toLowerCase().includes(q);
    for (const item of cat.items) {
      if (!q || catMatches || item.toLowerCase().includes(q)) {
        out.push(item);
      }
    }
  }
  return out;
}
