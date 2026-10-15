// Airports whose OurAirports municipality is a suburb, island or region
// rather than the city they serve. Used by scripts/build-data.mjs to place
// each airport's city on the map.
export const AIRPORT_CITY = {
  ACE: 'Arrecife', AYT: 'Antalya', BGY: 'Milan', BSL: 'Basel', BVA: 'Paris', CDG: 'Paris', CEB: 'Cebu', CGK: 'Jakarta',
  CIA: 'Rome', DCA: 'Washington', DME: 'Moscow', EWR: 'New York', FCO: 'Rome', GZP: 'Alanya', HND: 'Tokyo', IAD: 'Washington',
  ICN: 'Seoul', IST: 'Istanbul', JFK: 'New York', KUL: 'Kuala Lumpur', LCY: 'London', LGA: 'New York', LGW: 'London',
  LPA: 'Las Palmas de Gran Canaria', LTN: 'London', LYS: 'Lyon', MXP: 'Milan', NRT: 'Tokyo', ORY: 'Paris', PMI: 'Palma',
  SAW: 'Istanbul', STN: 'London', SVO: 'Moscow', TPE: 'Taipei', VKO: 'Moscow', YUL: 'Montreal', YYZ: 'Toronto',
};

// Cities whose name doesn't match the world cities dataset (or matches a
// smaller place nearby first): position given directly.
export const CITY_POSITION = {
  'New York': [-74.006, 40.7128],
  Washington: [-77.0369, 38.9072],
};
