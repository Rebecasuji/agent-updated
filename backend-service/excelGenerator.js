import ExcelJS from 'exceljs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function generateDailyExcel(data, dateStr) {
  const { employees, sessions, activityLogs, idleAlerts, screenshots } = data;
  
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TimeGuard System';
  workbook.created = new Date();

  // 1. Employee Daily Summary
  const summarySheet = workbook.addWorksheet('1. Daily Summary');
  summarySheet.columns = [
    { header: 'Employee Code', key: 'empCode', width: 15 },
    { header: 'Employee Name', key: 'empName', width: 25 },
    { header: 'Department', key: 'dept', width: 15 },
    { header: 'Login Time', key: 'login', width: 20 },
    { header: 'Logout Time', key: 'logout', width: 20 },
    { header: 'Total Session (s)', key: 'total', width: 15 },
    { header: 'Active Time (s)', key: 'active', width: 15 },
    { header: 'Productive Time (s)', key: 'prod', width: 15 },
    { header: 'Non-Productive Time (s)', key: 'nonProd', width: 20 },
    { header: 'Idle Time (s)', key: 'idle', width: 15 },
    { header: 'Away Time (s)', key: 'away', width: 15 },
    { header: 'Productivity %', key: 'prodPct', width: 15 },
    { header: 'Top Application', key: 'topApp', width: 30 },
  ];

  const empSummaries = {};

  employees.forEach(emp => {
    // Collect sessions
    const empSessions = sessions.filter(s => s.employee_id === emp.id);
    const empLogs = activityLogs.filter(a => a.employee_id === emp.id);
    const empIdles = idleAlerts.filter(i => i.employee_id === emp.id);

    let totalActive = 0, totalIdle = 0, totalProd = 0, totalNonProd = 0, totalAway = 0;
    
    empSessions.forEach(s => {
      totalActive += s.active_seconds || 0;
    });

    // App grouping for top app
    const apps = {};
    empLogs.forEach(log => {
      if (log.app_name) {
        apps[log.app_name] = (apps[log.app_name] || 0) + 1;
        if (log.is_productive) totalProd += 10; else totalNonProd += 10;
      }
    });
    
    let topApp = '';
    let max = 0;
    Object.keys(apps).forEach(k => {
      if (apps[k] > max) { max = apps[k]; topApp = k; }
    });

    empIdles.forEach(i => {
      if (i.duration_seconds) totalIdle += i.duration_seconds;
    });

    const totalSession = totalActive + totalIdle + totalAway;
    const prodPct = totalSession > 0 ? ((totalProd / totalSession) * 100).toFixed(2) : '0.00';

    const loginTime = empSessions.length > 0 ? empSessions[0].started_work_time : 'N/A';
    const logoutTime = empSessions.length > 0 ? empSessions[empSessions.length - 1].ended_work_time || 'N/A' : 'N/A';

    summarySheet.addRow({
      empCode: emp.employee_code,
      empName: emp.full_name || emp.employee_code,
      dept: emp.department || 'N/A',
      login: loginTime,
      logout: logoutTime,
      total: totalSession,
      active: totalActive,
      prod: totalProd,
      nonProd: totalNonProd,
      idle: totalIdle,
      away: totalAway,
      prodPct: prodPct,
      topApp: topApp
    });

    empSummaries[emp.id] = {
      employee_id: emp.id,
      employee_code: emp.employee_code,
      date: dateStr,
      login_time: loginTime !== 'N/A' ? loginTime : null,
      logout_time: logoutTime !== 'N/A' ? logoutTime : null,
      total_session_seconds: totalSession,
      active_seconds: totalActive,
      productive_seconds: totalProd,
      non_productive_seconds: totalNonProd,
      idle_seconds: totalIdle,
      away_seconds: totalAway,
      productivity_percentage: parseFloat(prodPct),
      top_application: topApp
    };
  });

  // 2. Application Usage
  const appSheet = workbook.addWorksheet('2. Application Usage');
  appSheet.columns = [
    { header: 'Employee Code', key: 'empCode', width: 15 },
    { header: 'Employee Name', key: 'empName', width: 25 },
    { header: 'Application Name', key: 'app', width: 30 },
    { header: 'Window Title', key: 'title', width: 40 },
    { header: 'Timestamp', key: 'time', width: 25 },
    { header: 'Productive/Non-Productive', key: 'type', width: 20 },
  ];

  activityLogs.filter(a => a.app_name).forEach(log => {
    const emp = employees.find(e => e.id === log.employee_id);
    appSheet.addRow({
      empCode: emp ? emp.employee_code : 'Unknown',
      empName: emp ? emp.full_name : 'Unknown',
      app: log.app_name,
      title: log.window_title || '',
      time: log.timestamp,
      type: log.is_productive ? 'Productive' : 'Non-Productive'
    });
  });

  // 3. Activity Timeline
  const timelineSheet = workbook.addWorksheet('3. Activity Timeline');
  timelineSheet.columns = [
    { header: 'Employee Code', key: 'empCode', width: 15 },
    { header: 'Timestamp', key: 'time', width: 25 },
    { header: 'Activity Type', key: 'type', width: 20 },
    { header: 'Application', key: 'app', width: 30 },
    { header: 'Window Title', key: 'title', width: 40 },
  ];
  activityLogs.forEach(log => {
    const emp = employees.find(e => e.id === log.employee_id);
    timelineSheet.addRow({
      empCode: emp ? emp.employee_code : 'Unknown',
      time: log.timestamp,
      type: log.activity_type || 'Activity',
      app: log.app_name || '',
      title: log.window_title || ''
    });
  });

  // 4. Idle Logs
  const idleSheet = workbook.addWorksheet('4. Idle Logs');
  idleSheet.columns = [
    { header: 'Employee Code', key: 'empCode', width: 15 },
    { header: 'Idle Start Time', key: 'start', width: 25 },
    { header: 'Idle Duration', key: 'duration', width: 15 },
    { header: 'Idle Reason', key: 'reason', width: 40 },
  ];
  idleAlerts.forEach(log => {
    const emp = employees.find(e => e.id === log.employee_id);
    idleSheet.addRow({
      empCode: emp ? emp.employee_code : 'Unknown',
      start: log.created_at,
      duration: log.duration_seconds || 0,
      reason: log.idle_reason || ''
    });
  });

  // 5. Alerts & Warnings
  const alertSheet = workbook.addWorksheet('5. Alerts & Warnings');
  alertSheet.columns = [
    { header: 'Employee Code', key: 'empCode', width: 15 },
    { header: 'Alert Time', key: 'time', width: 25 },
    { header: 'Alert Type', key: 'type', width: 20 },
    { header: 'Alert Message', key: 'msg', width: 40 },
  ];
  idleAlerts.filter(a => a.alert_type).forEach(log => {
    const emp = employees.find(e => e.id === log.employee_id);
    alertSheet.addRow({
      empCode: emp ? emp.employee_code : 'Unknown',
      time: log.created_at,
      type: log.alert_type || 'Warning',
      msg: log.idle_reason || ''
    });
  });

  // 6. Screenshots Metadata
  const screenSheet = workbook.addWorksheet('6. Screenshots Metadata');
  screenSheet.columns = [
    { header: 'Employee Code', key: 'empCode', width: 15 },
    { header: 'Screenshot Timestamp', key: 'time', width: 25 },
    { header: 'Application', key: 'app', width: 30 },
  ];
  screenshots.forEach(log => {
    const emp = employees.find(e => e.id === log.employee_id);
    screenSheet.addRow({
      empCode: emp ? emp.employee_code : 'Unknown',
      time: log.captured_at,
      app: log.app_name || ''
    });
  });

  // 7. Browser & Website Usage
  const webSheet = workbook.addWorksheet('7. Browser & Website Usage');
  webSheet.columns = [
    { header: 'Employee Code', key: 'empCode', width: 15 },
    { header: 'Website URL', key: 'url', width: 40 },
    { header: 'Page Title', key: 'title', width: 40 },
    { header: 'Timestamp', key: 'time', width: 25 },
  ];
  activityLogs.filter(a => a.url).forEach(log => {
    const emp = employees.find(e => e.id === log.employee_id);
    webSheet.addRow({
      empCode: emp ? emp.employee_code : 'Unknown',
      url: log.url,
      title: log.window_title || '',
      time: log.timestamp
    });
  });

  // 8. Call & Location Logs
  const callSheet = workbook.addWorksheet('8. Call & Location Logs');
  callSheet.columns = [
    { header: 'Employee Code', key: 'empCode', width: 15 },
    { header: 'Call Details', key: 'call', width: 30 },
    { header: 'Location Details', key: 'loc', width: 30 },
    { header: 'Timestamp', key: 'time', width: 25 },
  ];
  activityLogs.filter(a => a.call_details || a.location_details).forEach(log => {
    const emp = employees.find(e => e.id === log.employee_id);
    callSheet.addRow({
      empCode: emp ? emp.employee_code : 'Unknown',
      call: log.call_details || '',
      loc: log.location_details || '',
      time: log.timestamp
    });
  });

  // 9. Executive Dashboard
  const execSheet = workbook.addWorksheet('9. Executive Dashboard');
  execSheet.columns = [
    { header: 'Metric', key: 'metric', width: 30 },
    { header: 'Value', key: 'value', width: 30 },
  ];
  execSheet.addRow({ metric: 'Total Employees', value: employees.length });
  execSheet.addRow({ metric: 'Total Active Hours', value: (Object.values(empSummaries).reduce((acc, curr) => acc + curr.active_seconds, 0) / 3600).toFixed(2) });
  execSheet.addRow({ metric: 'Total Productive Hours', value: (Object.values(empSummaries).reduce((acc, curr) => acc + curr.productive_seconds, 0) / 3600).toFixed(2) });
  execSheet.addRow({ metric: 'Total Idle Hours', value: (Object.values(empSummaries).reduce((acc, curr) => acc + curr.idle_seconds, 0) / 3600).toFixed(2) });

  const tempFilePath = path.join(__dirname, `monitoring_report_${dateStr}.xlsx`);
  await workbook.xlsx.writeFile(tempFilePath);

  return { filePath: tempFilePath, summaries: Object.values(empSummaries) };
}
