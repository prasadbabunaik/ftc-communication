function currentYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const APP_SETTINGS = {
  layout: '',
  referenceMonth: currentYearMonth(),
  layouts: {
    demo1: {
      sidebarCollapse: false,
      sidebarTheme: 'light',
    },
  },
};
