// Seed credentials — kept in sync with prisma/seed.js > seedUsers().
// Change here only if the seed file changes; tests reference this map by role.

export const USERS = {
  ADMIN:  { email: 'admin@ftc.gov.in',  password: 'Admin@123',  region: null  },
  NLDC:   { email: 'nldc@ftc.gov.in',   password: 'Nldc@123',   region: null  },
  SRLDC:  { email: 'srldc@ftc.gov.in',  password: 'Srldc@123',  region: 'SR'  },
  NRLDC:  { email: 'nrldc@ftc.gov.in',  password: 'Nrldc@123',  region: 'NR'  },
  ERLDC:  { email: 'erldc@ftc.gov.in',  password: 'Erldc@123',  region: 'ER'  },
  WRLDC:  { email: 'wrldc@ftc.gov.in',  password: 'Wrldc@123',  region: 'WR'  },
  NERLDC: { email: 'nerldc@ftc.gov.in', password: 'Nerldc@123', region: 'NER' },
};

export const ALL_ROLES = Object.keys(USERS);
export const RLDC_ROLES = ['SRLDC', 'NRLDC', 'ERLDC', 'WRLDC', 'NERLDC'];
export const READ_ALL_ROLES = ['ADMIN', 'NLDC'];
