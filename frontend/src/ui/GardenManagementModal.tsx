import { useEffect, useState } from 'react'
import type { Garden, GardenMember, GardenRole, Invite, KnownUser } from '../types'
import { DropdownField } from './DropdownField'

type Props = {
  gardens: Garden[]
  knownUsers: KnownUser[]
  isGlobalAdmin: boolean
  globalAdminUserId?: string
  currentGardenId?: string
  onClose: () => void
  onCreateGarden: (input: { name: string; organizationName?: string }) => Promise<Garden>
  onUpdateGarden: (gardenId: string, input: { name?: string; organizationName?: string; locationName?: string; address?: string; notes?: string }) => Promise<Garden>
  onDeleteGarden: (gardenId: string) => Promise<void>
  onListGardenMembers: (gardenId: string) => Promise<GardenMember[]>
  onSaveGardenMember: (gardenId: string, input: { userId: string; email?: string; displayName?: string; role: GardenRole }) => Promise<void>
  onDeleteGardenMember: (gardenId: string, memberId: string) => Promise<void>
  onDeleteKnownUser: (userId: string) => Promise<void>
  onListInvites: (input: { gardenId?: string }) => Promise<Invite[]>
  onCreateInvite: (input: { gardenId?: string; email?: string; role: string }) => Promise<Invite>
  onResendInvite: (inviteId: string) => Promise<Invite>
  onDeleteInvite: (inviteId: string) => Promise<void>
  onOpenPlacementOptions: () => void
}

const GARDEN_ROLES: GardenRole[] = ['owner', 'admin', 'editor', 'viewer']

const GARDEN_FIELD_HINTS = {
  selectedGarden: 'Choose an existing garden to manage its details, members, and invites, or select New Garden to create a new one.',
  name: 'The display name for this garden throughout the app.',
  organizationName: 'Optional organization, business, farm, or group name associated with this garden.',
  locationName: 'Optional short location label, such as Home Garden, Greenhouse, or North Field.',
  address: 'Optional physical address or location notes for this garden.',
  notes: 'Optional internal notes about this garden.',
  knownUser: 'Select an existing known user to add as a member of this garden.',
  memberRole: 'Choose the access level for the selected or manually entered garden member.',
  inviteEmail: 'Enter the email address that should receive access to this garden.',
  inviteRole: 'Choose the access level assigned when the invite is accepted.',
  inviteLink: 'Read-only invite URL that can be copied and shared with the invited user.',
}

function FieldLabel({ label, hint }: { label: string; hint?: string }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!visible) return
    const timeout = window.setTimeout(() => setVisible(false), 3000)
    return () => window.clearTimeout(timeout)
  }, [visible])

  function showHint() {
    setVisible(false)
    window.requestAnimationFrame(() => setVisible(true))
  }

  function hideHint() {
    setVisible(false)
  }

  return (
    <div className="label fieldLabel">
      <span>{label}</span>
      {hint ? (
        <button
          className={`helpIcon${visible ? ' show' : ''}`}
          type="button"
          aria-label={`${label} hint`}
          onMouseEnter={showHint}
          onMouseLeave={hideHint}
          onFocus={showHint}
          onBlur={hideHint}
          onClick={showHint}
        >
          ?
          {visible ? <span className="helpTooltip" role="tooltip">{hint}</span> : null}
        </button>
      ) : null}
    </div>
  )
}

function fallbackGarden(gardens: Garden[]) {
  return [...gardens].sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || a.id.localeCompare(b.id))[0] ?? null
}

function shortUserId(userId: string) {
  if (userId.length <= 14) return userId
  return `${userId.slice(0, 6)}...${userId.slice(-6)}`
}

function inviteUrl(token: string) {
  return `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(token)}`
}

export function GardenManagementModal({ gardens, knownUsers, isGlobalAdmin, globalAdminUserId, onClose, onCreateGarden, onUpdateGarden, onDeleteGarden, onListGardenMembers, onSaveGardenMember, onDeleteGardenMember, onDeleteKnownUser, onListInvites, onCreateInvite, onResendInvite, onDeleteInvite, onOpenPlacementOptions }: Props) {
  const [selectedGardenId, setSelectedGardenId] = useState<string>('__new__')
  const [gardenMembers, setGardenMembers] = useState<GardenMember[]>([])
  const [selectedGardenMemberIds, setSelectedGardenMemberIds] = useState<string[]>([])
  const [gardenInvites, setGardenInvites] = useState<Invite[]>([])
  const [gardenName, setGardenName] = useState('')
  const [gardenOrganizationName, setGardenOrganizationName] = useState('')
  const [gardenLocationName, setGardenLocationName] = useState('')
  const [gardenAddress, setGardenAddress] = useState('')
  const [gardenNotes, setGardenNotes] = useState('')
  const [deleteGardenArmed, setDeleteGardenArmed] = useState(false)
  const [deleteKnownUserArmedId, setDeleteKnownUserArmedId] = useState('')
  const [gardenKnownUserId, setGardenKnownUserId] = useState('')
  const [gardenRole, setGardenRole] = useState<GardenRole>('viewer')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('viewer')
  const [deleteInviteArmedId, setDeleteInviteArmedId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [knownUserError, setKnownUserError] = useState<string | null>(null)

  const isNewGarden = selectedGardenId === '__new__'
  const selectedGarden = gardens.find((garden) => garden.id === selectedGardenId) ?? null
  const selectedGardenKnownUser = knownUsers.find((knownUser) => knownUser.userId === gardenKnownUserId) ?? null
  const availableGardenUsers = knownUsers.filter((knownUser) => !gardenMembers.some((member) => member.userId === knownUser.userId))
  const inviteEmailValid = !inviteEmail.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim())
  const gardenDetailsChanged = Boolean(selectedGarden && (
    gardenName.trim() !== selectedGarden.name ||
    (gardenOrganizationName.trim() || undefined) !== selectedGarden.organizationName ||
    (gardenLocationName.trim() || undefined) !== selectedGarden.locationName ||
    (gardenAddress.trim() || undefined) !== selectedGarden.address ||
    (gardenNotes.trim() || undefined) !== selectedGarden.notes
  ))

  useEffect(() => {
    if (!selectedGardenId || selectedGardenId === '__new__') {
      setGardenMembers([])
      setGardenInvites([])
      return
    }
    void refreshGarden(selectedGardenId)
  }, [selectedGardenId])

  useEffect(() => {
    setGardenName(selectedGarden?.name ?? '')
    setGardenOrganizationName(selectedGarden?.organizationName ?? '')
    setGardenLocationName(selectedGarden?.locationName ?? '')
    setGardenAddress(selectedGarden?.address ?? '')
    setGardenNotes(selectedGarden?.notes ?? '')
    setDeleteGardenArmed(false)
  }, [selectedGarden])

  async function refreshGarden(gardenId: string) {
    setError(null)
    try {
      const [members, invites] = await Promise.all([onListGardenMembers(gardenId), onListInvites({ gardenId })])
      setGardenMembers(members)
      setSelectedGardenMemberIds((selected) => selected.filter((id) => members.some((member) => member.id === id)))
      setGardenInvites(invites)
      setDeleteInviteArmedId((id) => invites.some((invite) => invite.id === id) ? id : '')
    } catch (e: any) {
      setError(e?.message ?? String(e))
    }
  }

  async function saveGardenDetails() {
    if (!gardenName.trim()) return
    if (isNewGarden) {
      await run(async () => {
        const garden = await onCreateGarden({ name: gardenName.trim(), organizationName: gardenOrganizationName.trim() || undefined })
        if (gardenLocationName.trim() || gardenAddress.trim() || gardenNotes.trim()) {
          await onUpdateGarden(garden.id, {
            locationName: gardenLocationName.trim() || undefined,
            address: gardenAddress.trim() || undefined,
            notes: gardenNotes.trim() || undefined,
          })
        }
        setSelectedGardenId(garden.id)
      })
    } else {
      if (!selectedGardenId) return
      await run(async () => {
        await onUpdateGarden(selectedGardenId, {
          name: gardenName.trim(),
          organizationName: gardenOrganizationName.trim() || undefined,
          locationName: gardenLocationName.trim() || undefined,
          address: gardenAddress.trim() || undefined,
          notes: gardenNotes.trim() || undefined,
        })
      })
    }
  }

  async function deleteSelectedGarden() {
    if (!selectedGardenId || !selectedGarden) return
    if (!deleteGardenArmed) {
      setDeleteGardenArmed(true)
      return
    }
    const deletedGardenId = selectedGardenId
    await run(async () => {
      await onDeleteGarden(deletedGardenId)
      const nextGarden = fallbackGarden(gardens.filter((garden) => garden.id !== deletedGardenId))
      setSelectedGardenId(nextGarden?.id ?? '')
      setDeleteGardenArmed(false)
    })
  }

  async function saveGardenMember() {
    const input = gardenMemberInput()
    if (!selectedGardenId || !input) return
    await run(async () => {
      await onSaveGardenMember(selectedGardenId, input)
      resetGardenMemberInputs()
      await refreshGarden(selectedGardenId)
    })
  }

  function gardenMemberInput() {
    if (selectedGardenKnownUser) {
      return {
        userId: selectedGardenKnownUser.userId,
        email: selectedGardenKnownUser.email,
        displayName: selectedGardenKnownUser.displayName,
        role: gardenRole,
      }
    }
    return null
  }

  function resetGardenMemberInputs() {
    setGardenKnownUserId('')
  }

  async function createGardenInvite() {
    if (!selectedGardenId || !inviteEmail.trim() || !inviteEmailValid) return
    await run(async () => {
      await onCreateInvite({ gardenId: selectedGardenId, email: inviteEmail.trim() || undefined, role: inviteRole })
      setInviteEmail('')
      await refreshGarden(selectedGardenId)
    })
  }

  async function resendGardenInvite(inviteId: string) {
    if (!selectedGardenId) return
    await run(async () => {
      await onResendInvite(inviteId)
      await refreshGarden(selectedGardenId)
    })
  }

  async function deleteGardenInvite(invite: Invite) {
    if (!selectedGardenId) return
    if (deleteInviteArmedId !== invite.id) {
      setDeleteInviteArmedId(invite.id)
      return
    }
    await run(async () => {
      await onDeleteInvite(invite.id)
      setDeleteInviteArmedId('')
      await refreshGarden(selectedGardenId)
    })
  }

  function toggleSelectedGardenMember(memberId: string, selected: boolean) {
    setSelectedGardenMemberIds((current) => {
      if (selected) return current.includes(memberId) ? current : [...current, memberId]
      return current.filter((id) => id !== memberId)
    })
  }

  async function removeSelectedGardenMembers() {
    if (!selectedGardenId || !selectedGardenMemberIds.length) return
    await run(async () => {
      for (const memberId of selectedGardenMemberIds) await onDeleteGardenMember(selectedGardenId, memberId)
      setSelectedGardenMemberIds([])
      await refreshGarden(selectedGardenId)
    })
  }

  async function deleteKnownUser(userId: string) {
    if (userId === globalAdminUserId) return

    if (deleteKnownUserArmedId !== userId) {
      setDeleteKnownUserArmedId(userId)
      setKnownUserError(null)
      return
    }

    setBusy(true)
    setKnownUserError(null)
    try {
      await onDeleteKnownUser(userId)
      setDeleteKnownUserArmedId('')
      if (gardenKnownUserId === userId) resetGardenMemberInputs()
    } catch (e: any) {
      setKnownUserError(formatError(e))
    } finally {
      setBusy(false)
    }
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e: any) {
      setError(formatError(e))
    } finally {
      setBusy(false)
    }
  }

  function formatError(e: any) {
    if (e?.details?.error === 'garden_in_use') {
      const counts = e.details.counts ?? {}
      return `Cannot delete this garden because it still has ${counts.records ?? 0} record${counts.records === 1 ? '' : 's'}, ${counts.reminders ?? 0} reminder${counts.reminders === 1 ? '' : 's'}, and ${counts.orderItems ?? 0} assigned order item${counts.orderItems === 1 ? '' : 's'}. Move or delete those items first.`
    }
    return e?.message ?? String(e)
  }

  async function copyUserId(userId: string) {
    try {
      await navigator.clipboard?.writeText(userId)
    } catch {
      setError('Unable to copy user ID.')
    }
  }

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="garden-management-title" onMouseDown={onClose}>
      <div className="modal remindersModal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modalHeader">
          <div>
            <div className="modalTitle" id="garden-management-title">Gardens &amp; Access</div>
            <div className="modalSub">Manage gardens, garden details, members, and invite links.</div>
          </div>
          <button className="btn ghost compact" type="button" onClick={onClose}>Close</button>
        </div>
        <div className="modalBody remindersBody">
          {error ? <div className="error inlineError">{error}</div> : null}

          <section className="reminderComposer">
            <div className="subTitle">Gardens</div>
            <label className="field">
              <FieldLabel label="Garden" hint={GARDEN_FIELD_HINTS.selectedGarden} />
              <DropdownField label="Garden" value={selectedGardenId} options={[{ value: '__new__', label: 'Create new garden...' }, ...gardens.map((garden) => ({ value: garden.id, label: garden.name }))]} onChange={setSelectedGardenId} />
            </label>
            <div className="reminderSectionGroup">
              <div className="reminderSectionHeader"><div className="subTitle">Garden Details</div></div>
              <div className="grid2">
                <label className="field"><FieldLabel label="Name" hint={GARDEN_FIELD_HINTS.name} /><input className="input" value={gardenName} onChange={(event) => setGardenName(event.target.value)} /></label>
                <label className="field"><FieldLabel label="Organization Name" hint={GARDEN_FIELD_HINTS.organizationName} /><input className="input" value={gardenOrganizationName} onChange={(event) => setGardenOrganizationName(event.target.value)} /></label>
                <label className="field"><FieldLabel label="Location Name" hint={GARDEN_FIELD_HINTS.locationName} /><input className="input" value={gardenLocationName} onChange={(event) => setGardenLocationName(event.target.value)} /></label>
                <label className="field gridSpanFull"><FieldLabel label="Address" hint={GARDEN_FIELD_HINTS.address} /><input className="input" value={gardenAddress} onChange={(event) => setGardenAddress(event.target.value)} /></label>
                <label className="field gridSpanFull"><FieldLabel label="Notes" hint={GARDEN_FIELD_HINTS.notes} /><textarea className="textarea" value={gardenNotes} rows={3} onChange={(event) => setGardenNotes(event.target.value)} /></label>
              </div>
              <div className="gardenDetailsActionRow">
                <div className="rowActions reminderComposerActions">
                  {selectedGarden ? <button className="btn ghost compact" type="button" onClick={onOpenPlacementOptions}>Options</button> : null}
                  <button className="btn ghost compact" type="button" disabled={busy || !gardenName.trim() || (!isNewGarden && !gardenDetailsChanged)} onClick={() => void saveGardenDetails()}>{isNewGarden ? 'Create Garden' : 'Save Details'}</button>
                </div>
                {selectedGarden ? <button className="btn danger compact" type="button" disabled={busy} onClick={() => void deleteSelectedGarden()}>{deleteGardenArmed ? 'Confirm Delete Garden' : 'Delete Garden'}</button> : null}
              </div>
              {deleteGardenArmed ? <div className="callout warn invoiceConfirmMessage">Click Confirm Delete Garden to permanently delete this garden. Deletion is blocked if this is your last garden or if it has records, reminders, or assigned order items.</div> : null}
            </div>
            {selectedGarden ? renderGardenMembers() : null}
            {selectedGarden ? renderInviteComposer() : null}
            {selectedGarden ? renderInvites(gardenInvites) : null}
          </section>

          {isGlobalAdmin ? renderKnownUsers() : null}
        </div>
      </div>
    </div>
  )

  function renderGardenMembers() {
    const memberCountLabel = selectedGardenMemberIds.length || gardenMembers.length

    return (
      <div className="reminderSectionGroup">
        <div className="reminderSectionHeader"><div className="subTitle">Garden Members</div></div>
        <div className="grid2">
          <label className="field">
            <FieldLabel label="Known user" hint={GARDEN_FIELD_HINTS.knownUser} />
            <DropdownField label="Known user" value={gardenKnownUserId} options={[{ value: '', label: 'Select a known user...' }, ...availableGardenUsers.map((knownUser) => ({ value: knownUser.userId, label: knownUser.displayName || knownUser.email || knownUser.userId }))]} onChange={setGardenKnownUserId} />
          </label>
          <label className="field">
            <FieldLabel label="Role" hint={GARDEN_FIELD_HINTS.memberRole} />
            <DropdownField label="Role" value={gardenRole} options={GARDEN_ROLES.map((role) => ({ value: role, label: role }))} onChange={(value) => setGardenRole(value as GardenRole)} />
          </label>
        </div>
        <div className="memberActionRow"><button className="btn ghost compact" type="button" disabled={busy || !gardenMemberInput()} onClick={() => void saveGardenMember()}>Save Member</button><button className="btn danger compact" type="button" disabled={busy || !selectedGardenMemberIds.length} onClick={() => void removeSelectedGardenMembers()}>Remove Selected</button></div>
        <div className="gardenMemberListSection">
          <div className="subTitle">Members ({memberCountLabel})</div>
          <div className="memberCardGrid">
            {gardenMembers.map((member) => {
              const selected = selectedGardenMemberIds.includes(member.id)
              const displayLabel = member.displayName || member.email || member.userId
              return <div className={`memberCard${selected ? ' selected' : ''}`} key={member.id}><div className="memberCardBody"><span className="memberName">{displayLabel}</span>{member.email && member.email !== displayLabel ? <span className="muted memberMeta">{member.email}</span> : null}<span className="memberRoleBadge">{member.role}</span></div><label className="photoTileSelect" aria-label="Select garden member"><input type="checkbox" checked={selected} onChange={(event) => toggleSelectedGardenMember(member.id, event.target.checked)} /><span /></label></div>
            })}
          </div>
        </div>
      </div>
    )
  }

  function renderInviteComposer() {
    return (
      <div className="reminderSectionGroup">
        <div className="reminderSectionHeader"><div className="subTitle">Invite Links ({gardenInvites.length})</div></div>
        <div className="grid2">
          <label className="field"><FieldLabel label="Invite email" hint={GARDEN_FIELD_HINTS.inviteEmail} /><input className="input" type="email" inputMode="email" autoComplete="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} /></label>
          <label className="field"><FieldLabel label="Invite role" hint={GARDEN_FIELD_HINTS.inviteRole} /><DropdownField label="Invite role" value={inviteRole} options={GARDEN_ROLES.map((role) => ({ value: role, label: role }))} onChange={setInviteRole} /></label>
        </div>
        <div className="rowActions reminderComposerActions"><button className="btn ghost compact" type="button" disabled={busy || !selectedGardenId || !inviteEmail.trim() || !inviteEmailValid} onClick={() => void createGardenInvite()}>Create Invite</button></div>
      </div>
    )
  }

  function renderInvites(invites: Invite[]) {
    return (
      <div className="reminderSectionGroup">
        {invites.length ? invites.map((invite) => {
          const accepted = Boolean(invite.acceptedAt)
          const armed = deleteInviteArmedId === invite.id
          return (
            <div className="reminderCard" key={invite.id}>
              <div className="reminderCardDetails">
                <div>{invite.email || 'Open invite'} · {invite.role} · {accepted ? 'Accepted' : 'Pending'}</div>
                <FieldLabel label="Invite link" hint={GARDEN_FIELD_HINTS.inviteLink} />
                <input className="input" readOnly value={inviteUrl(invite.token)} onFocus={(event) => event.currentTarget.select()} />
              </div>
              <div className="rowActions reminderComposerActions">
                {!accepted ? <button className="btn ghost compact" type="button" disabled={busy} onClick={() => void resendGardenInvite(invite.id)}>Resend</button> : null}
                <button className="btn danger compact" type="button" disabled={busy} onClick={() => void deleteGardenInvite(invite)}>{armed ? (accepted ? 'Confirm Delete' : 'Confirm Revoke') : (accepted ? 'Delete' : 'Revoke')}</button>
              </div>
            </div>
          )
        }) : <div className="muted emptyReminders">No invites yet.</div>}
      </div>
    )
  }

  function renderKnownUsers() {
    return (
      <section className="reminderComposer">
        <div className="reminderSectionHeader"><div><div className="subTitle">Known Users</div><div className="photoGalleryCount">{knownUsers.length} user{knownUsers.length === 1 ? '' : 's'}</div></div></div>
        <div className="muted">Deletes only the saved user document used for member pickers. Existing garden memberships and Firebase Auth accounts are not removed.</div>
        {knownUserError ? <div className="error inlineError">{knownUserError}</div> : null}
        <div className="memberCardGrid">
          {knownUsers.map((knownUser) => {
            const label = knownUser.displayName || knownUser.email || knownUser.userId
            const armed = deleteKnownUserArmedId === knownUser.userId
            const isProtectedGlobalAdmin = knownUser.userId === globalAdminUserId
            return (
              <div className="memberCard knownUserCard" key={knownUser.userId}>
                <div className="memberCardBody">
                  <span className="memberName">{label}</span>
                  {knownUser.email && knownUser.email !== label ? <span className="muted memberMeta">{knownUser.email}</span> : null}
                  <button className="btn ghost compact knownUserIdButton" type="button" aria-label={`Copy user ID ${knownUser.userId}`} onClick={() => void copyUserId(knownUser.userId)}>{shortUserId(knownUser.userId)}</button>
                  {isProtectedGlobalAdmin ? <span className="memberRoleBadge">Global Admin</span> : <button className="btn danger compact" type="button" disabled={busy} onClick={() => void deleteKnownUser(knownUser.userId)}>{armed ? 'Confirm Delete User' : 'Delete User'}</button>}
                </div>
              </div>
            )
          })}
        </div>
        {!knownUsers.length ? <div className="muted emptyReminders">No known users yet.</div> : null}
      </section>
    )
  }
}
