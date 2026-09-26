import {beforeEach, describe, expect, it} from "vitest";
import type {RaidData} from "@/components/api/dawn-api";
import {getColumnIndex, getRaidByRow} from "@/host/dawnhub-raid-table";
import raidsTableHtml from "@/host/__tests__/fixtures/dawnhub-raids-table.html?raw"

const raids = [
    {_id: "0", loot: "vip", booked: 1, buyerSlots: "4", bookedClasses: ["mage"]},
    {_id: "1", loot: "unsaved", booked: 1, buyerSlots: "10"},
    {_id: "2", loot: "vip", booked: 1, buyerSlots: "4", bookedClasses: ["deathknight"]},
    {_id: "3", loot: "vip", booked: 4, buyerSlots: "4", bookedClasses: []},
    {_id: "4", loot: "vip", booked: 2, buyerSlots: "10", bookedClasses: ["warrior", "Priest"]}
] as RaidData[]

function rows() {
    return Array.from(document.querySelectorAll<HTMLTableRowElement>("table[role='grid'] > tbody > tr"))
}

function pressArmorFilter(armorType: string) {
    document.querySelector(`div[role='group'] button[value='${armorType}']`)!.setAttribute("aria-pressed", "true")
}

describe("Dawnhub's raid table", () => {
    beforeEach(() => {
        document.body.innerHTML = raidsTableHtml
    })

    it("finds a column by its header", () => {
        expect(getColumnIndex("Time")).toBe(1)
        expect(getColumnIndex("Nonexistent")).toBe(-1)
    })

    it("resolves each row to the raid at its position in the list Dawnhub loaded", () => {
        expect(rows().map(row => getRaidByRow(row, raids)?._id)).toStrictEqual(["0", "1", "2", "3", "4"])
    })

    it("numbers rows after Dawnhub's own VIP armor filter, the way Dawnhub renders them", () => {
        // Plate: only VIP raids with a slot left and no plate wearer booked yet stay - 0 (a mage booked).
        // 2 has a death knight, 3 is full, 4 has a warrior; 1 isn't VIP at all.
        pressArmorFilter("plate")

        expect(getRaidByRow(rows()[0]!, raids)?._id).toBe("0")
        expect(getRaidByRow(rows()[1]!, raids)).toBeUndefined()
    })

    it("combines armor types the way Dawnhub does: every picked one has to be open", () => {
        pressArmorFilter("cloth")
        pressArmorFilter("mail")

        // 0 has a mage (cloth), 4 has a priest (cloth) - only 2 still sells both cloth and mail.
        expect(getRaidByRow(rows()[0]!, raids)?._id).toBe("2")
    })

    it("resolves no raid for a row Dawnhub didn't number", () => {
        const row = document.createElement("tr")

        expect(getRaidByRow(row, raids)).toBeUndefined()
    })
})
