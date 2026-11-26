/**
 * Expanded Datevra Lifestyle Catalogue
 * 34 well-structured categories, 200+ distinct, zero-duplicate lifestyle options.
 * Shared across Profile and Onboarding (optional, multi-select, legacy-safe).
 */

export interface CatalogCategory {
  readonly id: string;
  readonly label: string;
  readonly items: readonly string[];
}

export const LIFESTYLE_CATEGORIES: readonly CatalogCategory[] = [
  {
    id: "smoking",
    label: "Smoking Habits",
    items: [
      "Non-smoker",
      "Social smoker",
      "Smoker",
      "Trying to quit",
      "Smoke-free home",
      "Vape-free",
    ],
  },
  {
    id: "drinking",
    label: "Drinking Habits",
    items: [
      "Non-drinker",
      "Social drinker",
      "Drinker",
      "Sober / Teetotaller",
      "Occasional wine or cocktail",
      "Craft beer appreciator",
      "Sober curious",
    ],
  },
  {
    id: "fitness",
    label: "Exercise & Fitness",
    items: [
      "Daily workout",
      "Gym regular",
      "Active lifestyle",
      "Occasional workout",
      "Home workouts",
      "Strength training",
      "Running & cardio",
      "Pilates & core",
      "CrossFit & HIIT",
    ],
  },
  {
    id: "sports-active",
    label: "Sports & Active Living",
    items: [
      "Recreational sports",
      "Weekend cricket or football",
      "Badminton regular",
      "Swimming regular",
      "Tennis or pickleball",
      "Cycling enthusiast",
      "Marathon & 10K runner",
    ],
  },
  {
    id: "food-culinary",
    label: "Food & Culinary Lifestyle",
    items: [
      "Foodie",
      "Home cook",
      "Loves trying new restaurants",
      "Street food explorer",
      "Café hopper",
      "Fine dining appreciator",
      "Weekend baker",
      "Meal prepper",
    ],
  },
  {
    id: "diet-nutrition",
    label: "Diet & Nutrition",
    items: [
      "Balanced diet",
      "High-protein diet",
      "Mindful eating",
      "Organic & whole foods",
      "Gluten-free lifestyle",
      "Intermittent fasting",
      "Ayurvedic eating",
    ],
  },
  {
    id: "veg-nonveg",
    label: "Vegetarian & Non-Vegetarian",
    items: [
      "Vegetarian",
      "Non-vegetarian",
      "Eggetarian",
      "Pescatarian",
      "Flexitarian",
      "Jain vegetarian",
      "Sattvic diet",
    ],
  },
  {
    id: "vegan-plant",
    label: "Vegan & Plant-Based",
    items: [
      "Vegan",
      "Plant-based",
      "Mostly plant-based",
      "Dairy-free",
      "Cruelty-free lifestyle",
    ],
  },
  {
    id: "pets",
    label: "Pets & Animals",
    items: [
      "Dog lover",
      "Cat lover",
      "Pet parent",
      "Open to pets",
      "Animal welfare supporter",
      "Allergic to pets",
      "Prefer pet-free home",
    ],
  },
  {
    id: "sleep",
    label: "Sleep Schedule",
    items: [
      "Early riser",
      "Night owl",
      "Flexible sleeper",
      "Consistent 8-hour sleeper",
      "Afternoon power napper",
      "Early to bed",
    ],
  },
  {
    id: "rhythm",
    label: "Morning vs. Night Rhythm",
    items: [
      "Morning person",
      "Sunrise coffee ritual",
      "Slow unhurried mornings",
      "Late-night creative",
      "Evening energised",
      "Midnight snacker",
    ],
  },
  {
    id: "social",
    label: "Social Lifestyle",
    items: [
      "Socially active",
      "Selective socialiser",
      "Small intimate gatherings",
      "House party host",
      "Dinner-party regular",
      "Low-key social life",
      "Community builder",
    ],
  },
  {
    id: "personality-energy",
    label: "Introversion & Extroversion",
    items: [
      "Introvert",
      "Extrovert",
      "Ambivert",
      "Omnivert",
      "Recharges in quiet spaces",
      "Thrives in one-on-one talks",
    ],
  },
  {
    id: "weekends",
    label: "Weekend Habits",
    items: [
      "Weekend traveller",
      "Café mornings",
      "Lazy Sunday homebody",
      "Outdoor day-trips",
      "Brunch & bookstore weekends",
      "Family weekend visits",
      "Live events & gigs",
    ],
  },
  {
    id: "travel",
    label: "Travel Lifestyle",
    items: [
      "Frequent traveller",
      "Slow traveller",
      "Solo traveller",
      "Boutique & luxury stays",
      "Backpacking & hostels",
      "Road-trip lover",
      "Staycation fan",
    ],
  },
  {
    id: "adventure-outdoors",
    label: "Adventure & Outdoors",
    items: [
      "Mountain lover",
      "Beach person",
      "Trekking & camping",
      "Nature walks",
      "Wildlife & safaris",
      "Water sports enthusiast",
      "Stargazing & outdoors",
    ],
  },
  {
    id: "spirituality",
    label: "Spirituality & Mindfulness",
    items: [
      "Spiritual",
      "Mindful living",
      "Gratitude journaling",
      "Faith-centred",
      "Secular & humanist",
      "Philosophical thinker",
    ],
  },
  {
    id: "meditation-yoga",
    label: "Meditation & Yoga",
    items: [
      "Daily yoga practitioner",
      "Morning meditation",
      "Breathwork & pranayama",
      "Wellness retreats",
      "Sound healing & mindfulness",
      "Mobility & stretching",
    ],
  },
  {
    id: "work-life",
    label: "Work-Life Balance",
    items: [
      "Healthy work boundaries",
      "Flexible remote schedule",
      "Work-hard, rest-hard",
      "Unplugged weekends",
      "Slow-living advocate",
      "Structured 9-to-5 routine",
    ],
  },
  {
    id: "career",
    label: "Career & Ambition",
    items: [
      "Career-focused",
      "Entrepreneurial",
      "Creative professional",
      "Mission-driven work",
      "Academic or researcher",
      "Growth-oriented",
    ],
  },
  {
    id: "education",
    label: "Education & Learning",
    items: [
      "Lifelong learner",
      "Avid book reader",
      "Postgraduate or specialist",
      "Self-taught builder",
      "Workshops & masterclasses",
      "Documentary & podcast learner",
    ],
  },
  {
    id: "family-plans",
    label: "Family Plans",
    items: [
      "Family-oriented",
      "Close to extended family",
      "Values family traditions",
      "Independent & family-friendly",
      "Building a chosen family",
    ],
  },
  {
    id: "children",
    label: "Children Preferences",
    items: [
      "Wants children",
      "Open to children",
      "Doesn't want children",
      "Has children",
      "Undecided on children",
    ],
  },
  {
    id: "communication",
    label: "Communication Style",
    items: [
      "Direct & honest",
      "Thoughtful texter",
      "Phone call person",
      "Voice note sender",
      "In-person communicator",
      "Daily check-ins",
      "Calm conflict resolver",
    ],
  },
  {
    id: "love-languages",
    label: "Love Languages",
    items: [
      "Words of affirmation",
      "Quality time",
      "Physical touch",
      "Acts of service",
      "Thoughtful gift giving",
      "Comfortable shared silence",
    ],
  },
  {
    id: "daily-routines",
    label: "Daily Routines & Beverages",
    items: [
      "Tea or chai lover",
      "Coffee person",
      "Matcha drinker",
      "Structured planner",
      "Spontaneous & go-with-the-flow",
      "Daily journal writer",
      "Neat & organised home",
    ],
  },
  {
    id: "sustainability",
    label: "Sustainability & Environment",
    items: [
      "Eco-conscious",
      "Minimalist living",
      "Zero-waste mindful",
      "Public transit or EV friendly",
      "Thrift & slow fashion",
      "Urban plant parent",
    ],
  },
  {
    id: "fashion-style",
    label: "Fashion & Personal Style",
    items: [
      "Minimalist classic style",
      "Ethnic & handloom lover",
      "Smart casual dresser",
      "Streetwear & sneakers",
      "Vintage & curated wardrobe",
      "Comfort-first dresser",
      "Dresses up for dates",
    ],
  },
  {
    id: "languages",
    label: "Languages Spoken",
    items: [
      "Bilingual",
      "Multilingual (3+ languages)",
      "Hindi & English fluent",
      "Regional language proud",
      "Learning a new language",
    ],
  },
  {
    id: "cultural-lifestyle",
    label: "Cultural Interests",
    items: [
      "Art & gallery regular",
      "Theatre & live music",
      "Indian classical arts",
      "World cinema buff",
      "Heritage & architecture walks",
      "Festival celebrator",
    ],
  },
  {
    id: "zodiac-astrology",
    label: "Zodiac & Astrology",
    items: [
      "Into astrology",
      "Casual horoscope reader",
      "Vedic astrology curious",
      "Sceptical about zodiac",
      "Astrology just for fun",
    ],
  },
  {
    id: "entertainment",
    label: "Entertainment Preferences",
    items: [
      "Cinema hall regular",
      "Cosy binge-watch nights",
      "Board games & trivia nights",
      "Stand-up comedy fan",
      "Live concerts & gigs",
      "Books over screens",
    ],
  },
  {
    id: "tech-digital",
    label: "Tech & Digital Habits",
    items: [
      "Low screen time",
      "Regular digital detoxes",
      "Early tech adopter",
      "Private social media",
      "Content creator",
      "Off social media",
    ],
  },
  {
    id: "financial-lifestyle",
    label: "Financial Lifestyle (Optional)",
    items: [
      "Mindful saver",
      "Experience-first spender",
      "Financially independent",
      "Long-term investor",
      "Comfortable splitting bills",
      "Simple & debt-free living",
    ],
  },
] as const;

export const ALL_LIFESTYLE_OPTIONS: readonly string[] = LIFESTYLE_CATEGORIES.flatMap(
  (cat) => cat.items,
);

export const LIFESTYLE_CATEGORY_BY_ITEM: ReadonlyMap<string, string> = new Map(
  LIFESTYLE_CATEGORIES.flatMap((cat) =>
    cat.items.map((item) => [item.toLowerCase(), cat.label] as const),
  ),
);

export function searchLifestyleOptions(query: string, categoryId?: string): string[] {
  const q = query.trim().toLowerCase();
  const source =
    categoryId && categoryId !== "all"
      ? LIFESTYLE_CATEGORIES.find((c) => c.id === categoryId)?.items ?? []
      : ALL_LIFESTYLE_OPTIONS;
  if (!q) return [...source];
  return source.filter((item) => item.toLowerCase().includes(q));
}
