/**
 * The archive shouts and the dock should not. See `placeCase.ts`.
 */

import { describe, expect, it } from 'vitest';

import { placeCase } from './placeCase.ts';

describe('placeCase', () => {
  it('cases the shouted names the US extract actually holds', () => {
    expect(placeCase('W 111TH ST')).toBe('W 111th St');
    expect(placeCase('COLLEGE BLVD')).toBe('College Blvd');
    expect(placeCase('ANTIOCH RD')).toBe('Antioch Rd');
    expect(placeCase('METCALF AVE')).toBe('Metcalf Ave');
    expect(placeCase('W 123RD ST')).toBe('W 123rd St');
    expect(placeCase('INDIAN CREEK PKWY')).toBe('Indian Creek Pkwy');
  });

  it('keeps the ordinal suffix lower, which capitalize cannot', () => {
    /* `text-transform: capitalize` gives `111Th`. The whole reason this is
       TypeScript and not CSS. */
    expect(placeCase('W 2ND ST')).toBe('W 2nd St');
    expect(placeCase('E 3RD AVE')).toBe('E 3rd Ave');
    expect(placeCase('1ST ST')).toBe('1st St');
  });

  it('keeps directions and route classes upper', () => {
    expect(placeCase('NW 39TH ST')).toBe('NW 39th St');
    expect(placeCase('SE 14TH AVE')).toBe('SE 14th Ave');
    expect(placeCase('US 69 HWY')).toBe('US 69 Hwy');
  });

  it('handles the prefixes and separators a plain rule gets wrong', () => {
    expect(placeCase('MCKINLEY AVE')).toBe('McKinley Ave');
    expect(placeCase("O'BRIEN RD")).toBe("O'Brien Rd");
    expect(placeCase('WAL-MART DR')).toBe('Wal-Mart Dr');
  });

  it('LEAVES A MAPPER’S OWN CASING ALONE', () => {
    /* Somebody who typed `Antioch Rd` meant it. Re-casing their string would be
       this module overruling the person who stood at the pole. */
    expect(placeCase('Antioch Rd')).toBe('Antioch Rd');
    expect(placeCase('W 119th St')).toBe('W 119th St');
    expect(placeCase('McDonald Way')).toBe('McDonald Way');
  });

  it('answers null for nothing, and never invents a name', () => {
    expect(placeCase(null)).toBeNull();
    expect(placeCase('')).toBeNull();
    expect(placeCase('   ')).toBeNull();
  });
});
