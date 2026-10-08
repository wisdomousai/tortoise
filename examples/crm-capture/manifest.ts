import { defineManifest } from '@agent-native/host/manifest';
import { crmCaptureModule } from './contracts';

/** Browser-safe identity of the CRM capture application. */
export default defineManifest({
  id: 'crm-capture',
  title: 'CRM capture',
  modules: [crmCaptureModule],
});
