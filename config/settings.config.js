function currentYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const APP_SETTINGS = {
  layout: '',
  referenceMonth: currentYearMonth(),
  layouts: {
    demo1: {
      // Sidebar starts collapsed (icon-only); hovering expands it.
      // See css/demos/demo1.css `.demo1.sidebar-collapse .sidebar:hover { ... }`
      sidebarCollapse: true,
      sidebarTheme: 'light',
    },
  },
};
