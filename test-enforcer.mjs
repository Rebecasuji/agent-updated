import { getPreviousWorkingDate, checkTimesheetSubmitted } from './dist/src/electron/timesheetEnforcer.js';

async function test() {
  const prevDate = getPreviousWorkingDate();
  console.log('Previous working date:', prevDate);
  const isSubmitted = await checkTimesheetSubmitted('E0041', prevDate);
  console.log('Is submitted:', isSubmitted);
}

test();
