import { default as xs, Observable } from 'xstream'
import delay from 'xstream/extra/delay'

export interface GearView<TModel> {
    (model: TModel): any
}

export interface GearTooth<TModel> {
    filter?: (model: TModel) => boolean
    view: GearView<TModel>
}

export interface GearTeeth<TModel> {
    [name: string]: GearTooth<TModel> | GearView<TModel>
}

export interface Gear<TActions, TModel> {
    catch?: (error: any, actions: TActions) => Observable<any>
    intent?: (sources: any) => TActions
    model?: (actions: TActions) => Observable<TModel>
    teeth?: GearTeeth<TModel>
}

export type Transmission = ((sources: any) => Observable<Gear<any, any>>) | Observable<Gear<any, any>>

export interface PedalOptions {
    defaultGear?: Gear<any, any>
    defaultFilter?: (model: any) => boolean
    sinkMap?: Map<string, string>
}

export function pedal(transmission: Transmission, {
    defaultGear = { intent: (sources: any) => ({}), model: (actions: any) => xs.of({}), teeth: {} as GearTeeth<any> },
    defaultFilter = (model: any) => true,
    sinkMap = new Map()
}: PedalOptions = {}) {
    let { catch: defaultCatch, intent: defaultIntent, model: defaultModel } = defaultGear
    defaultCatch = defaultCatch || ((error: any) => xs.throw(error))
    defaultIntent = defaultIntent || ((sources: any) => ({}))
    defaultModel = defaultModel || ((actions: any) => xs.of({}).compose(delay(300))) // TODO: Why does this delay work?

    // Fully expand tooth defaults to avoid doing all the tests below every time
    const teeth = Object.keys(defaultGear.teeth)
    const toothDefaults: { [name: string]: GearTooth<any> } = {}
    const emptyTeeth = teeth.reduce((accum, cur) => Object.assign(accum, { [cur]: xs.never() }), {})
    for (let tooth of teeth) {
        const defGearTooth = defaultGear.teeth[tooth]
        if (defGearTooth instanceof Function) {
            toothDefaults[tooth] = { filter: defaultFilter, view: defGearTooth }
        } else {
            toothDefaults[tooth] = { filter: (defGearTooth as GearTooth<any>).filter || defaultFilter, view: (defGearTooth as GearTooth<any>).view }
        }
    }

    // Filter helper
    const toothFilter = (name: string, tooth: GearTooth<any> | GearView<any>) => {
        if (!tooth || tooth instanceof Function) {
            return toothDefaults[name].filter
        } else {
            return (tooth as GearTooth<any>).filter || toothDefaults[name].filter
        }
    }

    // View helper
    const toothView = (name: string, tooth: GearTooth<any> | GearView<any>) => {
        if (!tooth) {
            return toothDefaults[name].view
        } else if (tooth instanceof Function) {
            return tooth
        } else {
            return (tooth as GearTooth<any>).view
        }
    }

    return (sources: any) => {
        let gear$: Observable<Gear<any, any>>
        if (transmission instanceof Function) {
            gear$ = transmission(sources)
        } else {
            gear$ = transmission as Observable<Gear<any, any>>
        }

        function shareReplay(s$, num) {
            return s$.fold((acc, x) => {
                acc.push(x)
                return acc
            }, []).take(num)
        }

        function shareValue(s$, value) {
            return s$.fold((acc, x) => {
                acc.push(x)
                return acc
            }, value)
        }

        let spin$ = xs.fromObservable(gear$).map((gear: Gear<any, any>) => {
            const actions = gear.intent ? gear.intent(sources) : defaultIntent(sources)
            const state$ = (gear.model ? gear.model(actions) : defaultModel(actions))
            const a$ = xs.fromObservable(state$)
                .replaceError((err: any) =>
                    xs.fromObservable(gear.catch ? gear.catch(err, actions) : defaultCatch(err, actions))
                )
            const b$ = shareReplay(a$, 1)

            const views = teeth.reduce((accum, tooth) => Object.assign(accum, {
                [tooth]: xs.fromObservable(state$).filter(toothFilter(tooth, gear.teeth[tooth])).map(toothView(tooth, gear.teeth[tooth]))
            }),
                {})

            return views
        })
        spin$ = shareValue(spin$, emptyTeeth)

        const sinks = teeth.reduce((accum, tooth) => Object.assign(accum, {
            [sinkMap.has(tooth) ? sinkMap.get(tooth) : tooth]: spin$.map((views: any) => views[tooth]).flatten()
        }),
            {})

        return sinks
    }
}
