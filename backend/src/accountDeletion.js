import { removeUserFromAllGardens, deleteOrphanedGardens } from './gardens.js'
import { listRecords, deleteRecord } from './records.js'
import { listMaintenanceReminders, deleteMaintenanceReminder } from './maintenanceReminders.js'
import { deleteOrderItemsForGarden } from './orders.js'
import { deleteKnownUser } from './users.js'

export async function deleteOwnAccount(userId) {
  const orphanedGardenIds = await removeUserFromAllGardens(userId)

  // Content must be gone through its own module (preserving side effects like orphaned photo
  // embedding cleanup) before the garden shell is torn down — garden_id is a real foreign key.
  for (const gardenId of orphanedGardenIds) {
    const records = await listRecords(gardenId)
    await Promise.all(records.map((record) => deleteRecord(record.id)))

    const reminders = await listMaintenanceReminders({ gardenId })
    await Promise.all(reminders.map((reminder) => deleteMaintenanceReminder(reminder.id, { gardenId })))

    await deleteOrderItemsForGarden(gardenId)
  }

  await deleteOrphanedGardens(orphanedGardenIds)
  await deleteKnownUser(userId, {})
}
