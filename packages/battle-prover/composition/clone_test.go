package composition

import "reflect"

// Fresh shape preserves compile-time kinds and VK constants; frontend.Compile
// mutates variable slots, so never compile the witness object itself.
func clone(v reflect.Value) reflect.Value {
	switch v.Kind() {
	case reflect.Pointer:
		if v.IsNil() {
			return v
		}
		o := reflect.New(v.Type().Elem())
		o.Elem().Set(clone(v.Elem()))
		return o
	case reflect.Interface:
		return v
	case reflect.Slice:
		if v.IsNil() {
			return v
		}
		o := reflect.MakeSlice(v.Type(), v.Len(), v.Len())
		for i := 0; i < v.Len(); i++ {
			o.Index(i).Set(clone(v.Index(i)))
		}
		return o
	case reflect.Array:
		o := reflect.New(v.Type()).Elem()
		for i := 0; i < v.Len(); i++ {
			o.Index(i).Set(clone(v.Index(i)))
		}
		return o
	case reflect.Struct:
		o := reflect.New(v.Type()).Elem()
		o.Set(v)
		for i := 0; i < v.NumField(); i++ {
			if o.Field(i).CanSet() && v.Type().Field(i).PkgPath == "" {
				o.Field(i).Set(clone(v.Field(i)))
			}
		}
		return o
	default:
		return v
	}
}
