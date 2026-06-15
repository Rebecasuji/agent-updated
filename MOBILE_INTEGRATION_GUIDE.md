# Mobile App Integration Guide

## Overview
The new agent desktop application now syncs with the **TimeGuardAgent mobile app** in real-time. Both apps share the same Supabase database, enabling complete data synchronization.

## What's Integrated

### 1. **Call Logs Tracking**
- ✅ All incoming, outgoing, and missed calls from mobile
- ✅ Call duration, contact name, phone number
- ✅ Real-time sync to desktop dashboard
- ✅ Call statistics and summaries

### 2. **Location Tracking**
- ✅ Current employee location (latitude, longitude, accuracy)
- ✅ Real-time GPS updates
- ✅ Location history throughout the day

### 3. **Field Visit Tracking**
- ✅ Client visits and field work
- ✅ Visit start/end times and locations
- ✅ Current ongoing visits
- ✅ Visit completion tracking

## Files Added

### Core Service (`src/lib/mobileSync.ts`)
Service layer for fetching mobile data from Supabase:
- `getTodayCallLogs(employeeId)` - Fetch today's calls
- `getTodayCallStats(employeeId)` - Get call statistics
- `getTodayFieldLocations(employeeId)` - Fetch location history
- `getTodayFieldVisits(employeeId)` - Get field visits
- `getLatestFieldLocation(employeeId)` - Get current location
- `getCallSummaryByContact(employeeId)` - Call frequency by contact

### UI Component (`src/components/MobileSyncWidget.tsx`)
A complete widget displaying mobile activity:
- Call logs with call type indicators
- Call statistics summary
- Field visits and locations
- Real-time updates every 30 seconds
- Tabbed interface (Calls / Field Activity)

### Custom Hooks (`src/hooks/useMobileSync.ts`)
React hooks for using mobile data:
- `useMobileSync(employeeId)` - Main hook with full data
- `useMobileMiniStats(employeeId)` - Lightweight stats for summaries

## How to Use

### Option 1: Add to Admin Monitoring Screen (Recommended)
Edit `src/components/AdminMonitoringScreen.tsx`:

```tsx
import MobileSyncWidget from './MobileSyncWidget';

// Inside your component, after fetching the selected employee:
return (
  <div className="space-y-6">
    {/* Existing components */}
    <ActivitySection />
    
    {/* Add mobile widget */}
    <MobileSyncWidget employeeId={selectedEmployee.id} />
    
    {/* More existing components */}
  </div>
);
```

### Option 2: Add to Monitoring Dashboard
Edit `src/components/MonitoringDashboard.tsx`:

```tsx
import MobileSyncWidget from './MobileSyncWidget';

// Inside the component JSX:
return (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
    {/* Existing dashboard sections */}
    
    {/* Add mobile sync widget - takes full width or half width based on your layout */}
    <MobileSyncWidget employeeId={currentEmployeeId} />
  </div>
);
```

### Option 3: Use in Custom Summary View
```tsx
import { useMobileMiniStats } from '../hooks/useMobileSync';

function EmployeeSummary({ employeeId }) {
  const { stats, loading } = useMobileMiniStats(employeeId);

  return (
    <div className="grid grid-cols-4 gap-4">
      <div>
        <p className="text-sm text-slate-600">Calls Today</p>
        <p className="text-2xl font-bold">{stats.totalCalls}</p>
      </div>
      <div>
        <p className="text-sm text-slate-600">Call Duration</p>
        <p className="text-2xl font-bold">{formatDuration(stats.totalCallDuration)}</p>
      </div>
      <div>
        <p className="text-sm text-slate-600">Field Visits</p>
        <p className="text-2xl font-bold">{stats.currentVisitCount}</p>
      </div>
      <div>
        <p className="text-sm text-slate-600">Last Call</p>
        <p className="text-sm font-semibold">{stats.lastCallTime || 'None'}</p>
      </div>
    </div>
  );
}
```

## Database Tables Used

The integration queries these Supabase tables (created on mobile app):

1. **`call_logs`**
   ```sql
   - id, employee_id, call_start, call_end
   - duration_seconds, call_type, contact_name
   - phone_number, created_at
   ```

2. **`field_locations`**
   ```sql
   - id, employee_id, lat, lng
   - accuracy, speed, timestamp, created_at
   ```

3. **`field_visits`**
   ```sql
   - id, employee_id, client_name
   - start_lat, start_lng, end_lat, end_lng
   - start_time, end_time, status, created_at
   ```

## Real-Time Updates

The mobile sync automatically refreshes every 30 seconds. For real-time updates:

```tsx
import { subscribeToCallLogs } from '../lib/mobileSync';

useEffect(() => {
  const subscription = subscribeToCallLogs(employeeId, (logs) => {
    setCallLogs(logs); // Update immediately when new call logged
  });
  
  return () => subscription.unsubscribe();
}, [employeeId]);
```

## Data Flow

```
Mobile App (TimeGuardAgent)
    ↓ (Auto-sync every 1-2 sec)
Supabase Database
    ↓ (Query on demand or subscribe)
Desktop Agent (New Agent)
    ↓ (Display in Dashboard)
Admin View
```

## Notes

- **Same Supabase Instance**: Both apps use `https://qdqypcwnrbdgqagfdeun.supabase.co`
- **No Data Conflicts**: Mobile sends data, desktop only reads
- **Employee Matching**: `employee_id` must match between both systems
- **No Existing Code Modified**: All integration files are new additions
- **Backward Compatible**: Existing dashboard functionality unchanged

## Troubleshooting

**No mobile data showing?**
1. Check `employee_id` matches between mobile login and desktop
2. Verify mobile app has call tracking enabled
3. Check browser DevTools → Network tab for Supabase queries
4. Ensure `.env` has correct Supabase credentials

**Location showing as null?**
- Mobile app needs location permission enabled
- GPS may need time to get first location

**Call logs empty but mobile shows calls?**
- Restart the desktop app to refresh Supabase connection
- Check if mobile is synced to same Supabase account

## Next Steps

1. ✅ Files created and ready to use
2. → Choose integration location (Admin Screen / Dashboard / Custom)
3. → Import `MobileSyncWidget` component
4. → Pass correct `employeeId` prop
5. → Test with a mobile device logging in with same credentials
