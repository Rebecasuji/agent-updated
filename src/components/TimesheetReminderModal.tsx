import { ClipboardList } from 'lucide-react';

interface TimesheetReminderModalProps {
  onDismiss: () => void;
  date: string;
}

export default function TimesheetReminderModal({ onDismiss, date }: TimesheetReminderModalProps) {
  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-rose-100 p-8 max-w-sm w-full text-center animate-[pop_0.3s_ease-out]">
        <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <ClipboardList className="w-9 h-9 text-rose-500" />
        </div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">Timesheet Reminder</h2>
        <p className="text-gray-600 text-sm mb-6">
          You didn't submit the timesheet for <span className="font-semibold text-rose-600">{date}</span>. 
          Please go and submit it!
        </p>
        <button
          onClick={onDismiss}
          className="w-full bg-gradient-to-r from-rose-500 to-red-500 hover:from-rose-600 hover:to-red-600 text-white font-semibold py-3 rounded-xl shadow transition-all"
        >
          OK, I will submit it!
        </button>
      </div>
    </div>
  );
}
