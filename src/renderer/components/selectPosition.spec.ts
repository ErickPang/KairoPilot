import {describe,expect,it} from 'vitest';
import {selectPosition} from './selectPosition';
const viewport={width:980,height:900};
describe('select popup placement',()=>{
 it('anchors a short menu above the composer without an artificial gap',()=>{
  expect(selectPosition({left:600,right:750,top:800,bottom:832,width:150},viewport,'top')).toMatchObject({placement:'top',bottom:106,top:undefined});
 });
 it('flips away from the top edge and keeps wide fields within the viewport',()=>{
  const result=selectPosition({left:850,right:1100,top:20,bottom:60,width:250},viewport,'top','end');
  expect(result.placement).toBe('bottom');expect(result.top).toBe(66);expect(result.left+result.width).toBeLessThanOrEqual(970);
 });
 it('flips a bottom menu when only the upper side has enough space',()=>{
  expect(selectPosition({left:10,right:200,top:850,bottom:880,width:190},viewport,'bottom').placement).toBe('top');
 });
 it('clamps popup width on a narrow viewport',()=>{
  const result=selectPosition({left:0,right:300,top:30,bottom:60,width:300},{width:180,height:400},'bottom');
  expect(result.width).toBe(160);expect(result.left).toBe(10);
 });
});
