import { describe, expect, it } from "vitest";
import type { PageGeometry } from "../../api/types";
import { boxToPdfRect, pdfRectToBox, pdfRectToPercent } from "../geometry";
import { CSS_UNITS, pageMapping } from "./mapping";

/**
 * The reference values come from pdf.js 6.4.299, which the app no longer ships. They were computed once, with
 * `getViewport({ scale })` and its `convertToViewportPoint` / `convertToPdfPoint`, on a 6-page PDF whose pages had these
 * boxes (the generator was `src/test/fixtures/pageBoxes.ts`, see commit b5b208c):
 *   normal               MediaBox [0 0 612 792]
 *   rotated90            MediaBox [0 0 612 792], /Rotate 90
 *   rotated270           MediaBox [0 0 595 842], /Rotate 270
 *   cropped              MediaBox [0 0 612 792], CropBox [50 30 400 500]
 *   croppedAndRotated    MediaBox [0 0 612 792], CropBox [50 30 400 500], /Rotate 90
 *   userUnit             MediaBox [10 20 310 420], /UserUnit 2
 * `geometry` is what `open_document` sends (the viewport at scale 1); each `scales` entry holds the viewport size and
 * the conversions of `POINTS` at that scale. Values are rounded to 9 decimals.
 */
type Reference = {
  geometry: PageGeometry;
  scales: {
    scale: number;
    width: number;
    height: number;
    toViewport: [number, number][];
    toPdf: [number, number][];
  }[];
};

// prettier-ignore
const REFERENCE = {normal:{geometry:{width:612,height:792,transform:[1,0,0,-1,0,792]},scales:[{scale:0.5,width:306,height:396,toViewport:[[0,396],[36,346],[150.25,190.875],[305.5,0.5]],toPdf:[[0,792],[144,592],[601,-28.5],[1222,-790]]},{scale:1,width:612,height:792,toViewport:[[0,792],[72,692],[300.5,381.75],[611,1]],toPdf:[[0,792],[72,692],[300.5,381.75],[611,1]]},{scale:1.3333333333333333,width:816,height:1056,toViewport:[[0,1056],[96,922.666666667],[400.666666667,509],[814.666666667,1.333333333]],toPdf:[[0,792],[54,717],[225.375,484.3125],[458.25,198.75]]},{scale:2.5,width:1530,height:1980,toViewport:[[0,1980],[180,1730],[751.25,954.375],[1527.5,2.5]],toPdf:[[0,792],[28.8,752],[120.2,627.9],[244.4,475.6]]},{scale:5.33,width:3261.96,height:4221.36,toViewport:[[0,4221.36],[383.76,3688.36],[1601.665,2034.7275],[3256.63,5.33]],toPdf:[[0,792],[13.508442777,773.238273921],[56.378986867,715.030018762],[114.634146341,643.594746717]]}]},rotated90:{geometry:{width:792,height:612,transform:[0,1,1,0,0,0]},scales:[{scale:0.5,width:396,height:306,toViewport:[[0,0],[50,36],[205.125,150.25],[395.5,305.5]],toPdf:[[0,0],[200,144],[820.5,601],[1582,1222]]},{scale:1,width:792,height:612,toViewport:[[0,0],[100,72],[410.25,300.5],[791,611]],toPdf:[[0,0],[100,72],[410.25,300.5],[791,611]]},{scale:1.3333333333333333,width:1056,height:816,toViewport:[[0,0],[133.333333333,96],[547,400.666666667],[1054.666666667,814.666666667]],toPdf:[[0,0],[75,54],[307.6875,225.375],[593.25,458.25]]},{scale:2.5,width:1980,height:1530,toViewport:[[0,0],[250,180],[1025.625,751.25],[1977.5,1527.5]],toPdf:[[0,0],[40,28.8],[164.1,120.2],[316.4,244.4]]},{scale:5.33,width:4221.36,height:3261.96,toViewport:[[0,0],[533,383.76],[2186.6325,1601.665],[4216.03,3256.63]],toPdf:[[0,0],[18.761726079,13.508442777],[76.969981238,56.378986867],[148.405253283,114.634146341]]}]},rotated270:{geometry:{width:842,height:595,transform:[0,-1,-1,0,842,595]},scales:[{scale:0.5,width:421,height:297.5,toViewport:[[421,297.5],[371,261.5],[215.875,147.25],[25.5,-8]],toPdf:[[595,842],[395,698],[-225.5,241],[-987,-380]]},{scale:1,width:842,height:595,toViewport:[[842,595],[742,523],[431.75,294.5],[51,-16]],toPdf:[[595,842],[495,770],[184.75,541.5],[-196,231]]},{scale:1.3333333333333333,width:1122.666666667,height:793.333333333,toViewport:[[1122.666666667,793.333333333],[989.333333333,697.333333333],[575.666666667,392.666666667],[68,-21.333333333]],toPdf:[[595,842],[520,788],[287.3125,616.625],[1.75,383.75]]},{scale:2.5,width:2105,height:1487.5,toViewport:[[2105,1487.5],[1855,1307.5],[1079.375,736.25],[127.5,-40]],toPdf:[[595,842],[555,813.2],[430.9,721.8],[278.6,597.6]]},{scale:5.33,width:4487.86,height:3171.35,toViewport:[[4487.86,3171.35],[3954.86,2787.59],[2301.2275,1569.685],[271.83,-85.28]],toPdf:[[595,842],[576.238273921,828.491557223],[518.030018762,785.621013133],[446.594746717,727.365853659]]}]},cropped:{geometry:{width:350,height:470,transform:[1,0,0,-1,-50,500]},scales:[{scale:0.5,width:175,height:235,toViewport:[[-25,250],[11,200],[125.25,44.875],[280.5,-145.5]],toPdf:[[50,500],[194,300],[651,-320.5],[1272,-1082]]},{scale:1,width:350,height:470,toViewport:[[-50,500],[22,400],[250.5,89.75],[561,-291]],toPdf:[[50,500],[122,400],[350.5,89.75],[661,-291]]},{scale:1.3333333333333333,width:466.666666667,height:626.666666667,toViewport:[[-66.666666667,666.666666667],[29.333333333,533.333333333],[334,119.666666667],[748,-388]],toPdf:[[50,500],[104,425],[275.375,192.3125],[508.25,-93.25]]},{scale:2.5,width:875,height:1175,toViewport:[[-125,1250],[55,1000],[626.25,224.375],[1402.5,-727.5]],toPdf:[[50,500],[78.8,460],[170.2,335.9],[294.4,183.6]]},{scale:5.33,width:1865.5,height:2505.1,toViewport:[[-266.5,2665],[117.26,2132],[1335.165,478.3675],[2990.13,-1551.03]],toPdf:[[50,500],[63.508442777,481.238273921],[106.378986867,423.030018762],[164.634146341,351.594746717]]}]},croppedAndRotated:{geometry:{width:470,height:350,transform:[0,1,1,0,-30,-50]},scales:[{scale:0.5,width:235,height:175,toViewport:[[-15,-25],[35,11],[190.125,125.25],[380.5,280.5]],toPdf:[[50,30],[250,174],[870.5,631],[1632,1252]]},{scale:1,width:470,height:350,toViewport:[[-30,-50],[70,22],[380.25,250.5],[761,561]],toPdf:[[50,30],[150,102],[460.25,330.5],[841,641]]},{scale:1.3333333333333333,width:626.666666667,height:466.666666667,toViewport:[[-40,-66.666666667],[93.333333333,29.333333333],[507,334],[1014.666666667,748]],toPdf:[[50,30],[125,84],[357.6875,255.375],[643.25,488.25]]},{scale:2.5,width:1175,height:875,toViewport:[[-75,-125],[175,55],[950.625,626.25],[1902.5,1402.5]],toPdf:[[50,30],[90,58.8],[214.1,150.2],[366.4,274.4]]},{scale:5.33,width:2505.1,height:1865.5,toViewport:[[-159.9,-266.5],[373.1,117.26],[2026.7325,1335.165],[4056.13,2990.13]],toPdf:[[50,30],[68.761726079,43.508442777],[126.969981238,86.378986867],[198.405253283,144.634146341]]}]},userUnit:{geometry:{width:600,height:800,transform:[2,0,0,-2,-20,840]},scales:[{scale:0.5,width:300,height:400,toViewport:[[-10,420],[62,320],[290.5,9.75],[601,-371]],toPdf:[[10,420],[82,320],[310.5,9.75],[621,-371]]},{scale:1,width:600,height:800,toViewport:[[-20,840],[124,640],[581,19.5],[1202,-742]],toPdf:[[10,420],[46,370],[160.25,214.875],[315.5,24.5]]},{scale:1.3333333333333333,width:800,height:1066.666666667,toViewport:[[-26.666666667,1120],[165.333333333,853.333333333],[774.666666667,26],[1602.666666667,-989.333333333]],toPdf:[[10,420],[37,382.5],[122.6875,266.15625],[239.125,123.375]]},{scale:2.5,width:1500,height:2000,toViewport:[[-50,2100],[310,1600],[1452.5,48.75],[3005,-1855]],toPdf:[[10,420],[24.4,400],[70.1,337.95],[132.2,261.8]]},{scale:5.33,width:3198,height:4264,toViewport:[[-106.6,4477.2],[660.92,3411.2],[3096.73,103.935],[6406.66,-3954.86]],toPdf:[[10,420],[16.754221388,410.619136961],[38.189493433,381.515009381],[67.317073171,345.797373358]]}]}} as unknown as Record<string, Reference>;
const NAMES = Object.keys(REFERENCE);
const POINTS: [number, number][] = [
  [0, 0],
  [72, 100],
  [300.5, 410.25],
  [611, 791],
];

const geometryOf = (name: string): PageGeometry => REFERENCE[name]!.geometry;

const close = (actual: number[], expected: number[]) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 6));
};

describe("pageMapping against pdf.js", () => {
  it.each(NAMES)("%s: size and conversions equal pdf.js's viewport at every scale", (name) => {
    const geometry = geometryOf(name);
    for (const reference of REFERENCE[name]!.scales) {
      const mapping = pageMapping(geometry, reference.scale);
      expect(mapping.width).toBeCloseTo(reference.width, 6);
      expect(mapping.height).toBeCloseTo(reference.height, 6);
      POINTS.forEach(([x, y], index) => {
        close(mapping.convertToViewportPoint(x, y), reference.toViewport[index]!);
        close(mapping.convertToPdfPoint(x, y), reference.toPdf[index]!);
      });
    }
  });

  it("includes CSS_UNITS among the reference scales", () => {
    expect(REFERENCE.normal!.scales.map((entry) => entry.scale)).toContain(CSS_UNITS);
  });

  it.each(NAMES)("%s: viewport -> PDF -> viewport returns the same point", (name) => {
    const mapping = pageMapping(geometryOf(name), 1.7);
    for (const [x, y] of POINTS) {
      const [vx, vy] = mapping.convertToViewportPoint(x, y) as [number, number];
      close(mapping.convertToPdfPoint(vx, vy), [x, y]);
    }
  });

  it.each(NAMES)("%s: a highlight rectangle survives the round trip at several zooms", (name) => {
    const geometry = geometryOf(name);
    const rect: [number, number, number, number] = [80, 120, 260, 144];
    for (const scale of [0.75, 1, 2, 4]) {
      const mapping = pageMapping(geometry, scale);
      const box = pdfRectToBox(rect, mapping);
      close(boxToPdfRect(box, mapping), rect);
    }
  });

  it.each(NAMES)("%s: the highlight's percentages do not depend on the zoom", (name) => {
    const geometry = geometryOf(name);
    const rect: [number, number, number, number] = [80, 120, 260, 144];
    const expected = pdfRectToPercent(rect, pageMapping(geometry, 1));
    for (const scale of [0.5, CSS_UNITS, 3]) {
      const percent = pdfRectToPercent(rect, pageMapping(geometry, scale));
      expect(percent.left).toBeCloseTo(expected.left, 6);
      expect(percent.top).toBeCloseTo(expected.top, 6);
      expect(percent.width).toBeCloseTo(expected.width, 6);
      expect(percent.height).toBeCloseTo(expected.height, 6);
    }
  });

  it("covers the cases that matter: a rotated page swaps its sides, a cropped one is shifted", () => {
    const rotated = pageMapping(geometryOf("rotated90"), 1);
    expect([rotated.width, rotated.height]).toEqual([792, 612]);
    const cropped = pageMapping(geometryOf("cropped"), 1);
    expect([cropped.width, cropped.height]).toEqual([350, 470]);
    // The CropBox corner (50, 500) is the top left of the page box.
    close(cropped.convertToViewportPoint(50, 500), [0, 0]);
    // The size follows the user unit: 300 x 400 points of 2 units each.
    const unit = pageMapping(geometryOf("userUnit"), 1);
    expect([unit.width, unit.height]).toEqual([600, 800]);
  });
});
