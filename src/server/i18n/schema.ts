export interface CommonTranslations {
  language: string;
  logout: string;
  close: string;
  save: string;
  cancel: string;
  create: string;
  copy: string;
  copied: string;
  optional: string;
  loading: string;
  errorPrefix: string;
  requestFailed: string;
  deleteFailed: string;
  themeLight: string;
  themeDark: string;
  themeSystem: string;
}

export interface LoginTranslations {
  pageTitle: string;
  login: string;
  oidc: string;
  divider: string;
  secretLabel: string;
  secretPlaceholder: string;
  secretDisabled: string;
  submit: string;
  errorBad: string;
  errorDisabled: string;
  errorRateLimited: string;
}

export interface DashboardTranslations {
  searchPlaceholder: string;
  allStatus: string;
  refreshStatus: string;
  online: string;
  offline: string;
  colName: string;
  colTags: string;
  colSessions: string;
  colSessionsHint: string;
  colAgentVersion: string;
  colOpencodeVersion: string;
  colHeartbeat: string;
  colStatus: string;
  noInstances: string;
  noMatch: string;
  infoTitle: string;
  addInstance: string;
  editInstance: string;
  deleteInstance: string;
  deployInstance: string;
  instanceName: string;
  instanceId: string;
  tagsHint: string;
  confirmDelete: string;
  confirmDeleteDesc: string;
  deleting: string;
  deployTitle: string;
  editTitle: string;
  addTitle: string;
  dockerRun: string;
  composeEnv: string;
  deploymentCommand: string;
  deployCredentialsHint: string;
  upgradeGuide: string;
  upgradeCommand: string;
  upgradeDowntime: string;
  upgradeDockerStep1: string;
  upgradeDockerStep2: string;
  upgradeDockerStep3: string;
  upgradeComposeStep1: string;
  upgradeComposeStep2: string;
  upgradeComposeStep3: string;
  sseConnected: string;
  sseDisconnected: string;
  actions: string;
  targetHost: string;
  targetPort: string;
  openUser: string;
  openUserClear: string;
  openPass: string;
  openPassKeep: string;
  openPassSet: string;
  openPassModify: string;
  openPassClear: string;
  openPassClearPending: string;
  openPassClearCancel: string;
  openCredentialsHint: string;
  setupGuide: string;
  detailId: string;
  detailStatus: string;
  detailTags: string;
  detailSessions: string;
  detailSessionsHint: string;
  detailLastSeen: string;
  detailUptime: string;
  detailConnectedAt: string;
  timeNow: string;
  timeMinutesAgo: string;
  timeHoursAgo: string;
  timeDaysAgo: string;
}

export interface NavTranslations {
  dashboard: string;
  switchInstance: string;
  refresh: string;
  offline: string;
}

export interface TranslationSchema {
  common: CommonTranslations;
  login: LoginTranslations;
  dashboard: DashboardTranslations;
  nav: NavTranslations;
}
