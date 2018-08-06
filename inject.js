var log = {};
window.my_open = window.open;
window.open=function (str1,str2,str3){
    console.log(str1);
    var new_win =  this.my_open(str1, str2,str3);
    return new_win;
}
