export type ArmorType = "cloth" | "leather" | "mail" | "plate"
export type LootType = "saved" | "unsaved" | "vip"
export type RaidDifficulty = "normal" | "heroic" | "mythic"

export const ARMOR_TYPES: ArmorType[] = ["cloth", "leather", "mail", "plate"]

export interface WowClass {
    /** How Dawnhub itself writes the class - in a booking's `class` field and a raid's `bookedClasses`. */
    name: string
    armorType: ArmorType
    label: string
}

/**
 * Every playable class and the armor type it wears - fixed game data rather than something anyone tunes, so
 * it is built in.
 */
export const WOW_CLASSES: WowClass[] = [
    {name: "mage", armorType: "cloth", label: "Mage"},
    {name: "warlock", armorType: "cloth", label: "Warlock"},
    {name: "priest", armorType: "cloth", label: "Priest"},
    {name: "druid", armorType: "leather", label: "Druid"},
    {name: "monk", armorType: "leather", label: "Monk"},
    {name: "rogue", armorType: "leather", label: "Rogue"},
    {name: "demonhunter", armorType: "leather", label: "Demon Hunter"},
    {name: "hunter", armorType: "mail", label: "Hunter"},
    {name: "shaman", armorType: "mail", label: "Shaman"},
    {name: "evoker", armorType: "mail", label: "Evoker"},
    {name: "deathknight", armorType: "plate", label: "Death Knight"},
    {name: "warrior", armorType: "plate", label: "Warrior"},
    {name: "paladin", armorType: "plate", label: "Paladin"},
]

function normalizeClassName(value: string) {
    return value.toLowerCase().replace(/[^a-z]/g, "")
}

/** Finds a class however it is written - "deathknight" as Dawnhub stores it, or "Death Knight" as people type it. */
export function findWowClass(value: string): WowClass | undefined {
    const normalized = normalizeClassName(value)
    if (!normalized) return undefined
    return WOW_CLASSES.find(entry => entry.name === normalized || normalizeClassName(entry.label) === normalized)
}

export function isArmorType(value: string): value is ArmorType {
    return (ARMOR_TYPES as string[]).includes(value)
}
