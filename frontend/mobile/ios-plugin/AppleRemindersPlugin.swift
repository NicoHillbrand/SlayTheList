import Capacitor
import EventKit

/// Capacitor plugin that bridges Apple Reminders (EventKit) to the JS layer.
/// After running `npx cap add ios`, copy this file and the companion .m file
/// into `ios/App/App/`.
@objc(AppleRemindersPlugin)
public class AppleRemindersPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppleRemindersPlugin"
    public let jsName = "AppleReminders"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getLists", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getReminders", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createReminder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateReminder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteReminder", returnType: CAPPluginReturnPromise),
    ]

    private let store = EKEventStore()

    // MARK: - ISO 8601 helpers

    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private func isoString(_ date: Date?) -> String? {
        guard let date else { return nil }
        return Self.isoFormatter.string(from: date)
    }

    private func dateFromISO(_ string: String?) -> Date? {
        guard let string else { return nil }
        return Self.isoFormatter.date(from: string)
            ?? ISO8601DateFormatter().date(from: string) // fallback without fractional seconds
    }

    // MARK: - Reminder → Dictionary

    private func reminderDict(_ r: EKReminder) -> [String: Any?] {
        return [
            "id": r.calendarItemIdentifier,
            "title": r.title ?? "",
            "notes": r.notes,
            "isCompleted": r.isCompleted,
            "dueDate": r.dueDateComponents.flatMap { Calendar.current.date(from: $0) }.flatMap { isoString($0) },
            "completionDate": isoString(r.completionDate),
            "lastModified": isoString(r.lastModifiedDate),
        ]
    }

    // MARK: - Plugin methods

    @objc func requestAccess(_ call: CAPPluginCall) {
        if #available(iOS 17.0, *) {
            store.requestFullAccessToReminders { granted, error in
                if let error {
                    call.reject("Access request failed: \(error.localizedDescription)")
                } else {
                    call.resolve(["granted": granted])
                }
            }
        } else {
            store.requestAccess(to: .reminder) { granted, error in
                if let error {
                    call.reject("Access request failed: \(error.localizedDescription)")
                } else {
                    call.resolve(["granted": granted])
                }
            }
        }
    }

    @objc func getLists(_ call: CAPPluginCall) {
        let calendars = store.calendars(for: .reminder)
        let lists = calendars.map { cal -> [String: Any] in
            ["id": cal.calendarIdentifier, "title": cal.title]
        }
        call.resolve(["lists": lists])
    }

    @objc func getReminders(_ call: CAPPluginCall) {
        guard let listId = call.getString("listId") else {
            call.reject("Missing listId")
            return
        }
        guard let calendar = store.calendar(withIdentifier: listId) else {
            call.reject("List not found: \(listId)")
            return
        }

        let predicate = store.predicateForReminders(in: [calendar])
        store.fetchReminders(matching: predicate) { [weak self] reminders in
            guard let self else { return }
            let items = (reminders ?? []).map { self.reminderDict($0) }
            call.resolve(["reminders": items])
        }
    }

    @objc func createReminder(_ call: CAPPluginCall) {
        guard let listId = call.getString("listId"),
              let title = call.getString("title") else {
            call.reject("Missing listId or title")
            return
        }
        guard let calendar = store.calendar(withIdentifier: listId) else {
            call.reject("List not found: \(listId)")
            return
        }

        let reminder = EKReminder(eventStore: store)
        reminder.calendar = calendar
        reminder.title = title
        reminder.notes = call.getString("notes")

        if let dueDateStr = call.getString("dueDate"),
           let dueDate = dateFromISO(dueDateStr) {
            reminder.dueDateComponents = Calendar.current.dateComponents(
                [.year, .month, .day, .hour, .minute], from: dueDate
            )
        }

        do {
            try store.save(reminder, commit: true)
            call.resolve(["id": reminder.calendarItemIdentifier])
        } catch {
            call.reject("Failed to create reminder: \(error.localizedDescription)")
        }
    }

    @objc func updateReminder(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("Missing id")
            return
        }

        let predicate = store.predicateForReminders(in: nil)
        store.fetchReminders(matching: predicate) { [weak self] reminders in
            guard let self else { return }
            guard let reminder = reminders?.first(where: { $0.calendarItemIdentifier == id }) else {
                call.reject("Reminder not found: \(id)")
                return
            }

            if let title = call.getString("title") { reminder.title = title }
            if let notes = call.getString("notes") { reminder.notes = notes }
            if call.hasOption("isCompleted") { reminder.isCompleted = call.getBool("isCompleted") ?? false }

            if call.hasOption("dueDate") {
                if let dueDateStr = call.getString("dueDate"),
                   let dueDate = self.dateFromISO(dueDateStr) {
                    reminder.dueDateComponents = Calendar.current.dateComponents(
                        [.year, .month, .day, .hour, .minute], from: dueDate
                    )
                } else {
                    // null clears the due date
                    reminder.dueDateComponents = nil
                }
            }

            do {
                try self.store.save(reminder, commit: true)
                call.resolve()
            } catch {
                call.reject("Failed to update reminder: \(error.localizedDescription)")
            }
        }
    }

    @objc func deleteReminder(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("Missing id")
            return
        }

        let predicate = store.predicateForReminders(in: nil)
        store.fetchReminders(matching: predicate) { [weak self] reminders in
            guard let self else { return }
            guard let reminder = reminders?.first(where: { $0.calendarItemIdentifier == id }) else {
                call.reject("Reminder not found: \(id)")
                return
            }

            do {
                try self.store.remove(reminder, commit: true)
                call.resolve()
            } catch {
                call.reject("Failed to delete reminder: \(error.localizedDescription)")
            }
        }
    }
}
