import {describe, expect, it} from "vitest";
import {findWowClass, isArmorType, WOW_CLASSES} from "@/components/wow-classes";

describe("WoW classes", () => {
    it("covers every playable class exactly once", () => {
        expect(WOW_CLASSES.map(entry => entry.label).sort()).toStrictEqual([
            "Death Knight", "Demon Hunter", "Druid", "Evoker", "Hunter", "Mage", "Monk",
            "Paladin", "Priest", "Rogue", "Shaman", "Warlock", "Warrior"
        ])
    })

    it.each([
        ["deathknight", "plate"],
        ["Death Knight", "plate"],
        ["death-knight", "plate"],
        ["DEMON HUNTER", "leather"],
        ["evoker", "mail"],
        ["Priest", "cloth"]
    ])("finds %j however it is written, wearing %s", (name, armorType) => {
        expect(findWowClass(name)?.armorType).toBe(armorType)
    })

    it.each(["", "Necromancer", "   "])("finds no class called %j", name => {
        expect(findWowClass(name)).toBeUndefined()
    })

    it("tells armor types apart from anything else", () => {
        expect(["cloth", "leather", "mail", "plate", "Plate", "vip"].map(isArmorType)).toStrictEqual([true, true, true, true, false, false])
    })
})
