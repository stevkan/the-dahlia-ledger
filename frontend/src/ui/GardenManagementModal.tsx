import { useEffect, useState } from 'react'
import type { Garden, GardenMember, GardenOptions, GardenRole, Invite, KnownUser } from '../types'

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
  gardenOptions: GardenOptions
}

const GARDEN_ROLES: GardenRole[] = ['owner', 'admin', 'editor', 'viewer']

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

export function GardenManagementModal({ gardens, knownUsers, isGlobalAdmin, globalAdminUserId, currentGardenId, onClose, onCreateGarden, onUpdateGarden, onDeleteGarden, onListGardenMembers, onSaveGardenMember, onDeleteGardenMember, onDeleteKnownUser, onListInvites, onCreateInvite, onResendInvite, onDeleteInvite, onOpenPlacementOptions, gardenOptions }: Props) {
  const [selectedGardenId, setSelectedGardenId] = useState(currentGardenId || fallbackGarden(gardens)?.id || '')
  const [gardenMembers, setGardenMembers] = useState<GardenMember[]>([])
  const [selectedGardenMemberIds, setSelectedGardenMemberIds] = useState<string[]>([])
  const [gardenInvites, setGardenInvites] = useState<Invite[]>([])
  const [newGardenName, setNewGardenName] = useState('')
  const [gardenName, setGardenName] = useState('')
  const [gardenOrganizationName, setGardenOrganizationName] = useState('')
  const [gardenLocationName, setGardenLocationName] = useState('')
  const [gardenAddress, setGardenAddress] = useState('')
  const [gardenNotes, setGardenNotes] = useState('')
  const [deleteGardenArmed, setDeleteGardenArmed] = useState(false)
  const [deleteKnownUserArmedId, setDeleteKnownUserArmedId] = useState('')
  const [gardenKnownUserId, setGardenKnownUserId] = useState('')
  const [gardenAdvancedMemberOpen, setGardenAdvancedMemberOpen] = useState(false)
  const [gardenMemberUserId, setGardenMemberUserId] = useState('')
  const [gardenMemberEmail, setGardenMemberEmail] = useState('')
  const [gardenMemberDisplayName, setGardenMemberDisplayName] = useState('')
  const [gardenRole, setGardenRole] = useState<GardenRole>('viewer')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('viewer')
  const [deleteInviteArmedId, setDeleteInviteArmedId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedGardenOptionsSnapshot, setSavedGardenOptionsSnapshot] = useState('')

  const selectedGarden = gardens.find((garden) => garden.id === selectedGardenId) ?? null
  const selectedGardenKnownUser = knownUsers.find((knownUser) => knownUser.userId === gardenKnownUserId) ?? null
  const availableGardenUsers = knownUsers.filter((knownUser) => !gardenMembers.some((member) => member.userId === knownUser.userId))
  const gardenOptionsSnapshot = JSON.stringify(gardenOptions)
  const inviteEmailValid = !inviteEmail.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim())
  const gardenDetailsChanged = Boolean(selectedGarden && (
    gardenName.trim() !== selectedGarden.name ||
    (gardenOrganizationName.trim() || undefined) !== selectedGarden.organizationName ||
    (gardenLocationName.trim() || undefined) !== selectedGarden.locationName ||
    (gardenAddress.trim() || undefined) !== selectedGarden.address ||
    (gardenNotes.trim() || undefined) !== selectedGarden.notes ||
    gardenOptionsSnapshot !== savedGardenOptionsSnapshot
  ))

  useEffect(() => {
    if (!selectedGardenId) return
    void refreshGarden(selectedGardenId)
  }, [selectedGardenId])

  useEffect(() => {
    setGardenName(selectedGarden?.name ?? '')
    setGardenOrganizationName(selectedGarden?.organizationName ?? '')
    setGardenLocationName(selectedGarden?.locationName ?? '')
    setGardenAddress(selectedGarden?.address ?? '')
    setGardenNotes(selectedGarden?.notes ?? '')
    setSavedGardenOptionsSnapshot(gardenOptionsSnapshot)
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

  async function createGarden() {
    if (!newGardenName.trim()) return
    await run(async () => {
      const garden = await onCreateGarden({ name: newGardenName.trim() })
      setNewGardenName('')
      setSelectedGardenId(garden.id)
    })
  }

  async function saveGardenDetails() {
    if (!selectedGardenId || !gardenName.trim()) return
    await run(async () => {
      await onUpdateGarden(selectedGardenId, {
        name: gardenName.trim(),
        organizationName: gardenOrganizationName.trim() || undefined,
        locationName: gardenLocationName.trim() || undefined,
        address: gardenAddress.trim() || undefined,
        notes: gardenNotes.trim() || undefined,
      })
      setSavedGardenOptionsSnapshot(gardenOptionsSnapshot)
    })
  }

  async function deleteSelectedGarden() {
    if (!selectedGardenId || !selectedGarden) return
    if (!deleteGardenArmed) {
      setDeleteGardenArmed(true)
      return
    }
    await run(async () => {
      await onDeleteGarden(selectedGardenId)
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
    if (!gardenAdvancedMemberOpen || !gardenMemberUserId.trim()) return null
    if (gardenMembers.some((member) => member.userId === gardenMemberUserId.trim())) return null
    return { userId: gardenMemberUserId.trim(), email: gardenMemberEmail.trim() || undefined, displayName: gardenMemberDisplayName.trim() || undefined, role: gardenRole }
  }

  function resetGardenMemberInputs() {
    setGardenKnownUserId('')
    setGardenMemberUserId('')
    setGardenMemberEmail('')
    setGardenMemberDisplayName('')
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
      return
    }

    await run(async () => {
      await onDeleteKnownUser(userId)
      setDeleteKnownUserArmedId('')
      if (gardenKnownUserId === userId) resetGardenMemberInputs()
    })
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
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
            <div className="grid2">
              <label className="field">
                <div className="label">Selected garden</div>
                <select className="select" value={selectedGardenId} onChange={(event) => setSelectedGardenId(event.target.value)}>
                  {gardens.map((garden) => <option key={garden.id} value={garden.id}>{garden.name}</option>)}
                </select>
              </label>
              <label className="field">
                <div className="label">New garden name</div>
                <input className="input" value={newGardenName} onChange={(event) => setNewGardenName(event.target.value)} />
              </label>
            </div>
            <div className="rowActions reminderComposerActions">
              <button className="btn ghost compact" type="button" disabled={busy || !newGardenName.trim()} onClick={() => void createGarden()}>Create Garden</button>
            </div>
            {selectedGarden ? (
              <div className="reminderSectionGroup">
                <div className="reminderSectionHeader"><div className="subTitle">Garden Details</div></div>
                <div className="grid2">
                  <label className="field"><div className="label">Name</div><input className="input" value={gardenName} onChange={(event) => setGardenName(event.target.value)} /></label>
                  <label className="field"><div className="label">Organization Name</div><input className="input" value={gardenOrganizationName} onChange={(event) => setGardenOrganizationName(event.target.value)} /></label>
                  <label className="field"><div className="label">Location name</div><input className="input" value={gardenLocationName} onChange={(event) => setGardenLocationName(event.target.value)} /></label>
                  <label className="field gridSpanFull"><div className="label">Address</div><input className="input" value={gardenAddress} onChange={(event) => setGardenAddress(event.target.value)} /></label>
                  <label className="field gridSpanFull"><div className="label">Notes</div><textarea className="textarea" value={gardenNotes} rows={3} onChange={(event) => setGardenNotes(event.target.value)} /></label>
                </div>
                <div className="gardenDetailsActionRow">
                  <div className="rowActions reminderComposerActions">
                    <button className="btn ghost compact" type="button" onClick={onOpenPlacementOptions}>Options</button>
                    <button className="btn ghost compact" type="button" disabled={busy || !gardenName.trim() || !gardenDetailsChanged} onClick={() => void saveGardenDetails()}>Save Details</button>
                  </div>
                  <button className="btn danger compact" type="button" disabled={busy} onClick={() => void deleteSelectedGarden()}>{deleteGardenArmed ? 'Confirm Delete Garden' : 'Delete Garden'}</button>
                </div>
                {deleteGardenArmed ? <div className="callout warn invoiceConfirmMessage">Click Confirm Delete Garden to permanently delete this garden. Deletion is blocked if this is your last garden or if it has records, reminders, or assigned order items.</div> : null}
              </div>
            ) : null}
            {renderGardenMembers()}
            {renderInviteComposer()}
            {renderInvites(gardenInvites)}
          </section>

          {isGlobalAdmin ? renderKnownUsers() : null}
        </div>
      </div>
    </div>
  )

  function renderGardenMembers() {
    const duplicateManualUser = Boolean(gardenMemberUserId.trim() && gardenMembers.some((member) => member.userId === gardenMemberUserId.trim()))

    return (
      <div className="reminderSectionGroup">
        <div className="reminderSectionHeader"><div><div className="subTitle">Garden Members</div><div className="photoGalleryCount">{selectedGardenMemberIds.length ? `${selectedGardenMemberIds.length} selected` : `${gardenMembers.length} member${gardenMembers.length === 1 ? '' : 's'}`}</div></div></div>
        <div className="grid2">
          <label className="field">
            <div className="label">Known user</div>
            <select className="select" value={gardenKnownUserId} onChange={(event) => setGardenKnownUserId(event.target.value)}>
              <option value="">Select a known user...</option>
              {availableGardenUsers.map((knownUser) => <option key={knownUser.userId} value={knownUser.userId}>{knownUser.displayName || knownUser.email || knownUser.userId}</option>)}
            </select>
          </label>
          <label className="field">
            <div className="label">Role</div>
            <select className="select" value={gardenRole} onChange={(event) => setGardenRole(event.target.value as GardenRole)}>{GARDEN_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}</select>
          </label>
        </div>
        <div className="advancedMemberSection">
          <button className="btn ghost compact" type="button" onClick={() => setGardenAdvancedMemberOpen((open) => !open)}>{gardenAdvancedMemberOpen ? 'Hide Advanced Add' : 'Advanced: Add Existing User by ID'}</button>
          {gardenAdvancedMemberOpen ? (
            <div className="grid2 advancedMemberFields">
              <label className="field"><div className="label">User ID</div><input className="input" value={gardenMemberUserId} onChange={(event) => setGardenMemberUserId(event.target.value)} disabled={Boolean(gardenKnownUserId)} /></label>
              <label className="field"><div className="label">Email</div><input className="input" value={gardenMemberEmail} onChange={(event) => setGardenMemberEmail(event.target.value)} disabled={Boolean(gardenKnownUserId)} /></label>
              <label className="field"><div className="label">Display name</div><input className="input" value={gardenMemberDisplayName} onChange={(event) => setGardenMemberDisplayName(event.target.value)} disabled={Boolean(gardenKnownUserId)} /></label>
              <div className="muted advancedMemberHint">{duplicateManualUser ? 'This user is already a member.' : "Use this only for repair/backfill when you already know the user's authenticated ID."}</div>
            </div>
          ) : null}
        </div>
        <div className="memberActionRow"><button className="btn ghost compact" type="button" disabled={busy || !gardenMemberInput()} onClick={() => void saveGardenMember()}>Save Member</button><button className="btn danger compact" type="button" disabled={busy || !selectedGardenMemberIds.length} onClick={() => void removeSelectedGardenMembers()}>Remove Selected</button></div>
        <div className="memberCardGrid">
          {gardenMembers.map((member) => {
            const selected = selectedGardenMemberIds.includes(member.id)
            return <div className={`memberCard${selected ? ' selected' : ''}`} key={member.id}><div className="memberCardBody"><span className="memberName">{member.displayName || member.email || member.userId}</span><span className="memberRoleBadge">{member.role}</span></div><label className="photoTileSelect" aria-label="Select garden member"><input type="checkbox" checked={selected} onChange={(event) => toggleSelectedGardenMember(member.id, event.target.checked)} /><span /></label></div>
          })}
        </div>
      </div>
    )
  }

  function renderInviteComposer() {
    return (
      <div className="reminderSectionGroup">
        <div className="reminderSectionHeader"><div className="subTitle">Invite Links</div><span className="reminderCount">{gardenInvites.length}</span></div>
        <div className="grid2">
          <label className="field"><div className="label">Invite email</div><input className="input" type="email" inputMode="email" autoComplete="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} /></label>
          <label className="field"><div className="label">Invite role</div><select className="select" value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>{GARDEN_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
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
