import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {fillBookingForm} from "@/components/booking-intent/booking-form";

/** Dawnhub's booking form, down to the fields and the character search button this extension touches. */
function renderBookingForm({searchDisabled = false, withSearch = true} = {}) {
    document.body.innerHTML = `
        <form>
            <input id="rioUrl">
            <input id="nameRealm">
            ${withSearch ? `<button type="button" aria-label="search"${searchDisabled ? " disabled" : ""}>search</button>` : ""}
            <input id="class" value="Death Knight">
            <input name="source" value="id">
            <input id="pot" value="">
            <input id="deposit" value="50">
            <input id="privateNote" value="">
        </form>`
    const form = document.querySelector("form")!
    const inputs = new Map<string, string[]>()
    // Records what each field received the way React would see it: through its input events.
    form.addEventListener("input", event => {
        const input = event.target as HTMLInputElement
        inputs.set(input.id, [...inputs.get(input.id) ?? [], input.value])
    })
    const searchButton = form.querySelector<HTMLButtonElement>("button[aria-label='search']")
    const searchedFor: string[] = []
    searchButton?.addEventListener("click", () => searchedFor.push(form.querySelector<HTMLInputElement>("#nameRealm")!.value))
    return {form, inputs, searchButton, searchedFor, field: (id: string) => form.querySelector<HTMLInputElement>(`#${id}`)!}
}

describe("fillBookingForm", () => {
    afterEach(() => {
        vi.useRealTimers()
        document.body.replaceChildren()
    })

    it("fills the pot, types the name-realm, then runs Dawnhub's own character search for it", async () => {
        const {form, inputs, searchedFor, field} = renderBookingForm()

        const outcome = await fillBookingForm(form, {nameRealm: "Bob-Kazzak", price: "250", curveBoss: ""})

        expect(outcome).toBe("filled")
        expect(field("pot").value).toBe("250")
        expect(field("privateNote").value).toBe("")
        expect(inputs.get("nameRealm")).toStrictEqual(["Bob-Kazzak"])
        expect(searchedFor).toStrictEqual(["Bob-Kazzak"])
    })

    it("leaves everything it has no value for exactly as Dawnhub had it", async () => {
        const {form, inputs, field} = renderBookingForm()

        await fillBookingForm(form, {nameRealm: "", price: "", curveBoss: ""})

        expect(inputs.size).toBe(0)
        expect(field("deposit").value).toBe("50")
        expect(field("class").value).toBe("Death Knight")
    })

    it("never searches without a name-realm to search for", async () => {
        const {form, searchedFor} = renderBookingForm()

        await fillBookingForm(form, {nameRealm: "", price: "250", curveBoss: ""})

        expect(searchedFor).toStrictEqual([])
    })

    describe("with Dawnhub's search button disabled until it re-renders", () => {
        beforeEach(() => {
            vi.useFakeTimers()
        })

        it("waits for the button to be enabled before clicking it", async () => {
            const {form, searchButton, searchedFor} = renderBookingForm({searchDisabled: true})

            const filling = fillBookingForm(form, {nameRealm: "Bob-Kazzak", price: "", curveBoss: ""})
            await vi.advanceTimersByTimeAsync(200)
            expect(searchedFor).toStrictEqual([])

            searchButton!.disabled = false
            await vi.advanceTimersByTimeAsync(50)

            expect(await filling).toBe("filled")
            expect(searchedFor).toStrictEqual(["Bob-Kazzak"])
        })

        it("says so when the search button never becomes clickable, with the name-realm still filled in", async () => {
            const {form, searchedFor, field} = renderBookingForm({searchDisabled: true})

            const filling = fillBookingForm(form, {nameRealm: "Bob-Kazzak", price: "", curveBoss: ""})
            await vi.advanceTimersByTimeAsync(2000)

            expect(await filling).toBe("filled_without_search")
            expect(searchedFor).toStrictEqual([])
            expect(field("nameRealm").value).toBe("Bob-Kazzak")
        })
    })

    it("says so when Dawnhub's form has no search button at all", async () => {
        const {form} = renderBookingForm({withSearch: false})

        expect(await fillBookingForm(form, {nameRealm: "Bob-Kazzak", price: "", curveBoss: ""})).toBe("filled_without_search")
    })

    it("fails loudly rather than silently skip a field Dawnhub no longer renders", async () => {
        const {form, field} = renderBookingForm()
        field("pot").remove()

        await expect(fillBookingForm(form, {nameRealm: "", price: "250", curveBoss: ""})).rejects.toThrow("Dawnhub's booking form has no pot field.")
    })

    describe("on a curve raid", () => {
        /** Dawnhub's "Bosses" group: a label per boss, each with its checkbox - both ticked to start with. */
        function renderCurveBosses(checked = [true, true]) {
            const group = document.createElement("div")
            group.innerHTML = `
                <p>Bosses</p>
                <label><input type="checkbox"${checked[0] ? " checked" : ""}><span class="MuiFormControlLabel-label">The Coiled Altar</span></label>
                <label><input type="checkbox"${checked[1] ? " checked" : ""}><span class="MuiFormControlLabel-label">Ula'tek</span></label>`
            document.querySelector("form")!.prepend(group)
            return () => Array.from(group.querySelectorAll("input")).map(input => input.checked)
        }

        it("ticks only the boss the booking is for, clicking the boxes the way the advertiser would", async () => {
            const {form} = renderBookingForm()
            const ticked = renderCurveBosses()
            const clicks = vi.fn()
            form.addEventListener("click", clicks)

            await fillBookingForm(form, {nameRealm: "", price: "", curveBoss: "Ula'tek"})

            expect(ticked()).toStrictEqual([false, true])
            expect(clicks).toHaveBeenCalledOnce()
        })

        it("ticks every boss for a booking on both", async () => {
            const {form} = renderBookingForm()
            const ticked = renderCurveBosses([false, true])

            await fillBookingForm(form, {nameRealm: "", price: "", curveBoss: "Both"})

            expect(ticked()).toStrictEqual([true, true])
        })

        it("leaves a raid without boss checkboxes alone rather than fail the fill", async () => {
            const {form, field} = renderBookingForm()

            await fillBookingForm(form, {nameRealm: "", price: "250", curveBoss: "Ula'tek"})

            expect(field("pot").value).toBe("250")
        })
    })
})
