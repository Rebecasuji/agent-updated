import { Bell } from 'lucide-react';

interface PMSNotificationModalProps {
  tasks: number;
  discussions: number;
  onDismiss: () => void;
}

export default function PMSNotificationModal({ tasks, discussions, onDismiss }: PMSNotificationModalProps) {
  const hasTasks = tasks > 0;
  const hasDiscussions = discussions > 0;

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-purple-100 p-8 max-w-xs w-full text-center animate-[pop_0.3s_ease-out]">
        <div className="w-16 h-16 bg-purple-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <Bell className="w-9 h-9 text-purple-500 animate-bounce" />
        </div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">PMS Update</h2>
        
        <div className="text-gray-500 text-sm mb-6 flex flex-col gap-2">
          <p>You have new updates in the PMS!</p>
          {hasTasks && (
            <p className="font-semibold text-purple-600">
              {tasks} new {tasks === 1 ? 'task assigned' : 'tasks assigned'}
            </p>
          )}
          {hasDiscussions && (
            <p className="font-semibold text-pink-600">
              {discussions} unread {discussions === 1 ? 'discussion' : 'discussions'}
            </p>
          )}
        </div>
        
        <button
          onClick={onDismiss}
          className="w-full bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white font-semibold py-3 rounded-xl shadow transition-all"
        >
          OK, Got It!
        </button>
      </div>
    </div>
  );
}
